use crate::blackboard::{BlackboardAPI, ContentItem, Course, UserInfo};
use crate::login::LoginManager;
use crate::state::{AppState, Session};
use crate::store::FileStamp;
use crate::webeep;
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use futures_util::StreamExt;
use tauri::{AppHandle, Manager, Emitter};

#[derive(Clone)]
pub struct FileToDownload {
    pub course_id: String,
    pub course_name: String,
    pub content_id: String,
    pub attachment_id: String,
    pub file_name: String,
    pub relative_path: String,
    // Ultra body links (signed bbcswebdav) and every WeBeep file; None means a REST attachment.
    pub url: Option<String>,
    pub webeep: bool,
    // Server-side last change, to spot a file re-uploaded under the same name.
    pub stamp: Option<String>,
}

/// One download: `version` 1 is the plain path, higher ones "name (vN).ext".
/// `known` is the version on record before this sync, 0 if none.
struct Job {
    file: FileToDownload,
    version: u32,
    known: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgressPayload {
    pub phase: String,
    pub current: u64,
    pub total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncResultCourse {
    pub course_name: String,
    pub files: Vec<String>,
    pub webeep: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub total_downloaded: u64,
    pub total_scanned: u64,
    pub courses: Vec<SyncResultCourse>,
    pub duration: u64,
    pub warnings: Vec<String>,
}

pub async fn trigger_sync(app: &AppHandle) {
    let state = app.state::<AppState>();

    let session = {
        state.session.lock().unwrap().clone()
    };
    let has_webeep = {
        let store = state.store.lock().unwrap();
        store.load_webeep_token().is_some() && store.get_config().webeep_enabled
    };

    if session.is_none() && !has_webeep {
        app.emit("sync-progress", SyncProgressPayload {
            phase: "error".to_string(),
            current: 0,
            total: 0,
            current_file: None,
            error: Some("Nessun account collegato. Effettua l'accesso.".to_string()),
        }).ok();
        return;
    }

    if state.syncing.swap(true, Ordering::SeqCst) {
        return;
    }

    state.abort_flag.store(false, Ordering::SeqCst);
    app.emit("sync-start", ()).ok();

    let result = run_sync(app, session.as_ref()).await;

    match result {
        // Stopped before anything arrived: no "up to date" summary, and lastSync is left alone.
        Ok(sync_result)
            if state.abort_flag.load(Ordering::SeqCst) && sync_result.total_downloaded == 0 =>
        {
            app.emit("sync-complete", ()).ok();
        }
        Ok(sync_result) => {
            let config = state.store.lock().unwrap().get_config();
            if !state.abort_flag.load(Ordering::SeqCst) {
                let mut store = state.store.lock().unwrap();
                store.update_config(serde_json::json!({
                    "lastSync": chrono::Utc::now().to_rfc3339()
                }));
            }
            app.emit("sync-complete", sync_result.clone()).ok();

            if config.notifications {
                let is_visible = app
                    .get_webview_window("main")
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);

                if !is_visible {
                    let mut body = if sync_result.total_downloaded > 0 {
                        format!("Scaricati {} file nuovi", sync_result.total_downloaded)
                    } else {
                        "Nessun file nuovo trovato".to_string()
                    };
                    if !sync_result.warnings.is_empty() {
                        body.push_str(&format!(" · {}", sync_result.warnings.join(" · ")));
                    }
                    use tauri_plugin_notification::NotificationExt;
                    app.notification()
                        .builder()
                        .title("BlackBoard Sync")
                        .body(&body)
                        .show()
                        .ok();
                }
            }
        }
        Err(e) => {
            app.emit("sync-progress", SyncProgressPayload {
                phase: "error".to_string(),
                current: 0,
                total: 0,
                current_file: None,
                error: Some(e),
            }).ok();
        }
    }

    state.syncing.store(false, Ordering::SeqCst);
}

/// Separate from `run_sync` so a Blackboard failure becomes a warning, not a failed sync.
async fn open_blackboard(
    app: &AppHandle,
    session: &Session,
) -> Result<(BlackboardAPI, Vec<Course>), String> {
    let (api, user) = ensure_valid_session(app, session).await?;
    let courses = api.get_courses_for_sync(&user.id).await?;
    Ok((api, courses))
}

async fn run_sync(app: &AppHandle, session: Option<&Session>) -> Result<SyncResult, String> {
    let state = app.state::<AppState>();
    let config = state.store.lock().unwrap().get_config();
    let abort_flag = Arc::clone(&state.abort_flag);
    let start = std::time::Instant::now();

    let mut warnings: Vec<String> = Vec::new();

    // Opened side by side; one failing becomes a warning so the other still syncs.
    let (bb_opened, wb_opened) = tokio::join!(
        async {
            match session {
                None => Ok(None),
                Some(s) => open_blackboard(app, s).await.map(Some),
            }
        },
        async {
            match webeep::active_api(app).await? {
                None => Ok(None),
                Some((api, info)) => {
                    let courses = webeep::get_courses(&api, info.userid).await?;
                    Ok::<_, String>(Some((api, courses)))
                }
            }
        }
    );

    let bb_source = bb_opened.unwrap_or_else(|e| {
        warnings.push(format!("Bocconi: {}", e));
        None
    });
    let wb_source = wb_opened.unwrap_or_else(|e| {
        warnings.push(format!("PoliMi: {}", e));
        None
    });

    if bb_source.is_none() && wb_source.is_none() {
        return Err(if warnings.is_empty() {
            "Nessun account collegato. Effettua l'accesso.".to_string()
        } else {
            warnings.join(" · ")
        });
    }

    let mut all_courses: Vec<Course> = Vec::new();
    if let Some((_, courses)) = &bb_source {
        all_courses.extend(courses.iter().cloned());
    }
    if let Some((_, courses)) = &wb_source {
        all_courses.extend(courses.iter().cloned());
    }
    let dirs = course_dirs(&all_courses, &config.course_aliases);

    let mut courses: Vec<Course> = if config.sync_all_courses {
        all_courses
    } else {
        all_courses.into_iter()
            .filter(|c| config.enabled_courses.contains(&c.id))
            .collect()
    };
    if !config.hidden_courses.is_empty() {
        courses.retain(|c| !config.hidden_courses.contains(&c.id));
    }
    if !config.hidden_terms.is_empty() {
        courses.retain(|c| {
            c.term.as_ref().map(|t| !config.hidden_terms.contains(&t.id)).unwrap_or(true)
        });
    }

    let total_courses = courses.len() as u64;
    let scanned_count = Arc::new(std::sync::atomic::AtomicU64::new(0));

    let scan_handles: Vec<_> = courses.iter().map(|course| {
        let bb_api = bb_source.as_ref().map(|(api, _)| api.clone());
        let wb_api = wb_source.as_ref().map(|(api, _)| api.clone());
        let course = course.clone();
        let abort = Arc::clone(&abort_flag);
        let app_h = app.clone();
        let base = dirs[&course.id].clone();
        let counter = Arc::clone(&scanned_count);

        tokio::spawn(async move {
            let files = if webeep::is_webeep(&course.id) {
                match wb_api {
                    Some(api) => webeep::scan_course(&api, &course, &base).await.map(|f| (f, None)),
                    None => Ok((Vec::new(), None)),
                }
            } else {
                match bb_api {
                    Some(api) => scan_course(&api, &course, &base, &abort).await,
                    None => Ok((Vec::new(), None)),
                }
            };
            let done = counter.fetch_add(1, Ordering::SeqCst) + 1;
            app_h.emit("sync-progress", SyncProgressPayload {
                phase: "scanning".to_string(),
                current: done,
                total: total_courses,
                current_file: Some(course.name.clone()),
                error: None,
            }).ok();
            files
        })
    }).collect();

    // Blackboard scans check `abort_flag` themselves, so this join ends promptly on abort.
    let scan_results = futures_util::future::join_all(scan_handles).await;
    let mut all_files: Vec<FileToDownload> = Vec::new();
    for (course, result) in courses.iter().zip(scan_results) {
        let name = config.course_aliases.get(&course.id).unwrap_or(&course.name);
        match result {
            Ok(Ok((files, warning))) => {
                all_files.extend(files);
                if let Some(w) = warning {
                    warnings.push(format!("{}: {}", name, w));
                }
            }
            Ok(Err(e)) => warnings.push(format!("{}: {}", name, e)),
            Err(_) => {}
        }
    }

    let mut seen_paths: HashSet<String> = HashSet::new();
    all_files.retain(|f| seen_paths.insert(f.relative_path.clone()));

    let sync_dir = PathBuf::from(&config.sync_dir);
    let canon_base = sync_dir.canonicalize().ok();
    let lex_base = normalize_path(&sync_dir);

    // Missing files are downloaded; existing ones only when the server's stamp
    // moved, and then as a new version beside the old one.
    let mut stamps = state.store.lock().unwrap().load_file_stamps();
    let mut to_download: Vec<Job> = Vec::new();
    for f in &all_files {
        let full = sync_dir.join(&f.relative_path);
        if !is_inside_resolved(&full, canon_base.as_deref(), &lex_base) {
            continue;
        }
        let known = stamps.get(&f.relative_path).map_or(0, |s| s.version);
        if !full.exists() {
            to_download.push(Job { file: f.clone(), version: 1, known });
            continue;
        }
        let Some(stamp) = &f.stamp else { continue };
        match stamps.get(&f.relative_path) {
            // On disk from before versioning: the current server state is the baseline.
            None => {
                stamps.insert(f.relative_path.clone(), FileStamp { stamp: stamp.clone(), version: 1 });
            }
            Some(s) if &s.stamp != stamp => {
                to_download.push(Job { file: f.clone(), version: known + 1, known });
            }
            _ => {}
        }
    }
    state.store.lock().unwrap().save_file_stamps(&stamps);

    let total_scanned = all_files.len() as u64;

    if to_download.is_empty() {
        app.emit("sync-progress", SyncProgressPayload {
            phase: "complete".to_string(),
            current: 0,
            total: 0,
            current_file: None,
            error: None,
        }).ok();
        return Ok(SyncResult {
            total_downloaded: 0,
            total_scanned,
            courses: vec![],
            duration: start.elapsed().as_secs(),
            warnings,
        });
    }

    // 8 workers: on a live 83-file / 119 MB sync 3 took 6.1 s, 8 took 2.7 s, 12 took 2.1 s;
    // past 8 the gain is not worth the extra load on the university servers.
    let total_dl = to_download.len() as u64;
    let queue = Arc::new(tokio::sync::Mutex::new(VecDeque::from(to_download)));
    let downloaded_count = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let processed_count = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let failed_files: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
    let downloaded_files: Arc<tokio::sync::Mutex<Vec<FileToDownload>>> =
        Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let new_stamps: Arc<std::sync::Mutex<Vec<(String, FileStamp)>>> =
        Arc::new(std::sync::Mutex::new(Vec::new()));

    let concurrency = 8usize.min(total_dl as usize);
    let mut handles = Vec::new();

    for _ in 0..concurrency {
        let queue = Arc::clone(&queue);
        let bb_api = bb_source.as_ref().map(|(api, _)| api.clone());
        let wb_api = wb_source.as_ref().map(|(api, _)| api.clone());
        let abort = Arc::clone(&abort_flag);
        let app_h = app.clone();
        let sync_dir = sync_dir.clone();
        let canon_base = canon_base.clone();
        let lex_base = lex_base.clone();
        let dl_count = Arc::clone(&downloaded_count);
        let done_count = Arc::clone(&processed_count);
        let failed = Arc::clone(&failed_files);
        let dl_files = Arc::clone(&downloaded_files);
        let new_stamps = Arc::clone(&new_stamps);

        let h = tokio::spawn(async move {
            loop {
                if abort.load(Ordering::SeqCst) { break; }

                let job = {
                    let mut q = queue.lock().await;
                    q.pop_front()
                };
                let Some(Job { mut file, mut version, known }) = job else { break };

                let fetched = if file.webeep {
                    match (&wb_api, &file.url) {
                        (Some(api), Some(url)) => api.download(url).await,
                        _ => Err("WeBeep non connesso".to_string()),
                    }
                } else {
                    match (&bb_api, &file.url) {
                        (Some(api), Some(url)) => api.download_url(url).await,
                        (Some(api), None) => api
                            .download_file(&file.course_id, &file.content_id, &file.attachment_id)
                            .await,
                        (None, _) => Err("Bocconi non connessa".to_string()),
                    }
                };

                match fetched {
                    Ok(response) => {
                        if abort.load(Ordering::SeqCst) { break; }

                        // A new stamp can come from an edit that left the file as it
                        // was, so the copy before it decides whether a version is kept.
                        let previous = (version > 1)
                            .then(|| {
                                [versioned_path(&file.relative_path, known), file.relative_path.clone()]
                                    .into_iter()
                                    .map(|p| sync_dir.join(p))
                                    .find(|p| p.exists())
                            })
                            .flatten();
                        let mut full_path = sync_dir.join(versioned_path(&file.relative_path, version));
                        while version > 1 && full_path.exists() {
                            version += 1;
                            full_path = sync_dir.join(versioned_path(&file.relative_path, version));
                        }
                        if !is_inside_resolved(&full_path, canon_base.as_deref(), &lex_base) { continue; }

                        if let Some(dir) = full_path.parent() {
                            let _ = tokio::fs::create_dir_all(dir).await;
                        }
                        match save_response(response, &full_path, &abort, previous.as_deref()).await {
                            Err(e) => {
                                eprintln!("Download failed for {}: {}", file.file_name, e);
                                if !abort.load(Ordering::SeqCst) {
                                    failed.lock().unwrap().push(format!("{} ({})", file.file_name, e));
                                }
                            }
                            Ok(saved) => {
                                if let Some(stamp) = file.stamp.clone() {
                                    let version = if saved { version.max(known) } else { known.max(1) };
                                    new_stamps.lock().unwrap()
                                        .push((file.relative_path.clone(), FileStamp { stamp, version }));
                                }
                                if saved {
                                    dl_count.fetch_add(1, Ordering::SeqCst);
                                    if let Some(name) = full_path.file_name() {
                                        file.file_name = name.to_string_lossy().into_owned();
                                    }
                                    dl_files.lock().await.push(file.clone());
                                }
                                let done = done_count.fetch_add(1, Ordering::SeqCst) + 1;
                                app_h.emit("sync-progress", SyncProgressPayload {
                                    phase: "downloading".to_string(),
                                    current: done,
                                    total: total_dl,
                                    current_file: Some(file.file_name.clone()),
                                    error: None,
                                }).ok();
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Download failed for {}: {}", file.file_name, e);
                        failed.lock().unwrap().push(format!("{} ({})", file.file_name, e));
                    }
                }
            }
        });
        handles.push(h);
    }

    for h in handles {
        let _ = h.await;
    }

    for (path, stamp) in std::mem::take(&mut *new_stamps.lock().unwrap()) {
        stamps.insert(path, stamp);
    }
    state.store.lock().unwrap().save_file_stamps(&stamps);

    let downloaded = downloaded_count.load(Ordering::SeqCst);
    // Named, so the user can tell a transient error from a file that will never download.
    let failed = std::mem::take(&mut *failed_files.lock().unwrap());
    if !failed.is_empty() {
        warnings.push(format!(
            "{} file non scaricati, verranno riprovati al prossimo sync: {}",
            failed.len(),
            failed.join("; ")
        ));
    }
    let dl_files = downloaded_files.lock().await;

    let mut course_map: HashMap<String, SyncResultCourse> = HashMap::new();
    for f in dl_files.iter() {
        let entry = course_map.entry(f.course_id.clone()).or_insert_with(|| SyncResultCourse {
            course_name: f.course_name.clone(),
            files: vec![],
            webeep: f.webeep,
        });
        entry.files.push(f.file_name.clone());
    }

    app.emit("sync-progress", SyncProgressPayload {
        phase: "complete".to_string(),
        current: downloaded,
        total: total_dl,
        current_file: None,
        error: None,
    }).ok();

    Ok(SyncResult {
        total_downloaded: downloaded,
        total_scanned,
        courses: course_map.into_values().collect(),
        duration: start.elapsed().as_secs(),
        warnings,
    })
}

/// An expired cookie gets an HTML login page (a JSON decode error), so a failed `/users/me`
/// probe triggers a SAML re-auth with the stored credentials and saves the new session.
async fn ensure_valid_session(
    app: &AppHandle,
    session: &Session,
) -> Result<(BlackboardAPI, UserInfo), String> {
    let probe = BlackboardAPI::new(&session.cookies);
    if let Ok(user) = probe.get_current_user().await {
        return Ok((probe, user));
    }

    let state = app.state::<AppState>();
    let creds = state.store.lock().unwrap().load_credentials();
    let Some((username, password)) = creds else {
        return Err("Sessione scaduta. Rieffettua il login.".to_string());
    };

    let mut manager = LoginManager::new();
    let result = manager.login(&username, &password).await;
    if !result.success {
        return Err(result
            .error
            .unwrap_or_else(|| "Sessione scaduta. Rieffettua il login.".to_string()));
    }

    let cookies = result.cookies;
    let refreshed = BlackboardAPI::new(&cookies);
    let user = refreshed
        .get_current_user()
        .await
        .map_err(|_| "Sessione scaduta. Rieffettua il login.".to_string())?;

    {
        let mut s = state.session.lock().unwrap();
        *s = Some(Session { cookies: cookies.clone() });
    }
    state.store.lock().unwrap().save_session(&cookies);

    Ok((refreshed, user))
}

/// Overrides the clients' 30 s total timeout, which would cut off large videos.
pub const DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// Writes `<path>.part`, renamed when complete: sync skips existing files, so a truncated one
/// would never be refetched. A download identical to `same_as` is dropped with `Ok(false)`.
async fn save_response(
    response: reqwest::Response,
    path: &Path,
    abort: &std::sync::atomic::AtomicBool,
    same_as: Option<&Path>,
) -> Result<bool, String> {
    use tokio::io::AsyncWriteExt;

    let mut part = path.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);

    let result = async {
        let mut out = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
        let mut body = response.bytes_stream();
        while let Some(chunk) = body.next().await {
            if abort.load(Ordering::SeqCst) {
                return Err("interrotto".to_string());
            }
            out.write_all(&chunk.map_err(|e| e.to_string())?)
                .await
                .map_err(|e| e.to_string())?;
        }
        out.flush().await.map_err(|e| e.to_string())?;
        drop(out);
        if let Some(other) = same_as {
            let (a, b) = (part.clone(), other.to_path_buf());
            if tokio::task::spawn_blocking(move || files_equal(&a, &b)).await.unwrap_or(false) {
                return Ok(false);
            }
        }
        tokio::fs::rename(&part, path).await.map_err(|e| e.to_string())?;
        mark_as_downloaded(path).await;
        Ok(true)
    }
    .await;

    if result != Ok(true) {
        let _ = tokio::fs::remove_file(&part).await;
    }
    result
}

fn files_equal(a: &Path, b: &Path) -> bool {
    use std::io::Read;
    let (Ok(fa), Ok(fb)) = (std::fs::File::open(a), std::fs::File::open(b)) else {
        return false;
    };
    if fa.metadata().map(|m| m.len()).ok() != fb.metadata().map(|m| m.len()).ok() {
        return false;
    }
    let (mut ra, mut rb) = (std::io::BufReader::new(fa), std::io::BufReader::new(fb));
    let (mut ba, mut bb) = (vec![0u8; 64 * 1024], vec![0u8; 64 * 1024]);
    loop {
        let n = match ra.read(&mut ba) {
            Ok(0) => return true,
            Ok(n) => n,
            Err(_) => return false,
        };
        if rb.read_exact(&mut bb[..n]).is_err() || ba[..n] != bb[..n] {
            return false;
        }
    }
}

fn versioned_path(rel: &str, version: u32) -> String {
    if version <= 1 {
        return rel.to_string();
    }
    let path = Path::new(rel);
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let name = match path.extension() {
        Some(ext) => format!("{} (v{}).{}", stem, version, ext.to_string_lossy()),
        None => format!("{} (v{})", stem, version),
    };
    path.with_file_name(name).to_string_lossy().into_owned()
}

/// Mark-of-the-Web, so Office uses Protected View and SmartScreen/Gatekeeper
/// check course files like browser downloads. Best effort.
async fn mark_as_downloaded(path: &Path) {
    #[cfg(windows)]
    {
        let mut ads = path.as_os_str().to_owned();
        ads.push(":Zone.Identifier");
        let _ = tokio::fs::write(ads, "[ZoneTransfer]\r\nZoneId=3\r\n").await;
    }
    #[cfg(target_os = "macos")]
    {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = tokio::process::Command::new("xattr")
            .arg("-w")
            .arg("com.apple.quarantine")
            .arg(format!("0083;{:x};BlackBoard Sync;", secs))
            .arg(path)
            .output()
            .await;
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = path;
}

/// Folders and links never hold REST attachments, and a file item names its one in its own
/// `contentHandler`, so neither is worth an `/attachments` request.
fn may_have_attachments(handler: &str) -> bool {
    !(handler == "resource/x-bb-folder"
        || handler == "resource/x-bb-file"
        || ["link", "blti", "scorm", "asmt"].iter().any(|k| handler.contains(k)))
}

async fn scan_course(
    api: &BlackboardAPI,
    course: &Course,
    base_path: &str,
    abort_flag: &Arc<std::sync::atomic::AtomicBool>,
) -> Result<(Vec<FileToDownload>, Option<String>), String> {
    let items = api.get_all_contents(&course.id).await?;
    let lookups = files_from_contents(&items, course, base_path);

    const CONCURRENCY: usize = 6;
    let fetched: Vec<Result<Vec<FileToDownload>, String>> = futures_util::stream::iter(lookups.pending)
        .map(|(item_id, dir, stamp)| async move {
            if abort_flag.load(Ordering::SeqCst) {
                return Ok(Vec::new());
            }
            let attachments = api.get_attachments(&course.id, &item_id).await?;
            Ok(attachments
                .into_iter()
                .map(|att| FileToDownload {
                    course_id: course.id.clone(),
                    course_name: course.name.clone(),
                    content_id: item_id.clone(),
                    attachment_id: att.id,
                    relative_path: PathBuf::from(&dir)
                        .join(sanitize_path(&att.file_name))
                        .to_string_lossy()
                        .into_owned(),
                    file_name: att.file_name,
                    url: None,
                    webeep: false,
                    stamp: stamp.clone(),
                })
                .collect())
        })
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await;

    let failed = fetched.iter().filter(|r| r.is_err()).count();
    let mut files = lookups.files;
    files.extend(fetched.into_iter().flatten().flatten());
    separate_clashes(&mut files, &items);
    let warning = (failed > 0).then(|| format!("{} elementi non letti, riprovati al prossimo sync", failed));
    Ok((files, warning))
}

/// Same-named files of different items move into a folder named after their
/// item, otherwise the dedup in `run_sync` keeps only one.
fn separate_clashes(files: &mut [FileToDownload], items: &[ContentItem]) {
    let mut claims: HashMap<String, HashSet<String>> = HashMap::new();
    for f in files.iter() {
        claims.entry(f.relative_path.clone()).or_default().insert(f.content_id.clone());
    }
    let titles: HashMap<&str, &str> = items.iter().map(|i| (i.id.as_str(), i.title.as_str())).collect();

    for f in files.iter_mut() {
        if claims[&f.relative_path].len() < 2 {
            continue;
        }
        let path = PathBuf::from(&f.relative_path);
        let title = titles.get(f.content_id.as_str()).copied().unwrap_or(f.content_id.as_str());
        let dir = path.parent().unwrap_or(Path::new("")).join(sanitize_path(title));
        f.relative_path = dir
            .join(path.file_name().unwrap_or_default())
            .to_string_lossy()
            .into_owned();
    }
}

struct ContentScan {
    files: Vec<FileToDownload>,
    /// (item id, folder, stamp) for items whose attachments still need asking for.
    pending: Vec<(String, String, Option<String>)>,
}

/// Lays out a course's files from its flat, recursive content listing.
fn files_from_contents(items: &[ContentItem], course: &Course, base_path: &str) -> ContentScan {
    let by_id: HashMap<&str, &ContentItem> = items.iter().map(|i| (i.id.as_str(), i)).collect();

    // The course root is not in the listing, so the walk stops at the first unknown parent;
    // the depth cap guards against a parent cycle.
    let folder_of = |item: &ContentItem| -> String {
        let mut titles = Vec::new();
        let mut parent = item.parent_id.as_deref();
        while let Some(p) = parent.and_then(|id| by_id.get(id)) {
            if titles.len() > 20 {
                break;
            }
            titles.push(sanitize_path(&p.title));
            parent = p.parent_id.as_deref();
        }
        let mut dir = PathBuf::from(base_path);
        for t in titles.iter().rev() {
            dir.push(t);
        }
        dir.to_string_lossy().into_owned()
    };

    let mut scan = ContentScan { files: Vec::new(), pending: Vec::new() };
    for item in items {
        let dir = folder_of(item);
        let handler = item
            .content_handler
            .as_ref()
            .and_then(|h| h["id"].as_str())
            .unwrap_or_default();
        let file = |name: String, attachment_id: String, url: Option<String>| FileToDownload {
            course_id: course.id.clone(),
            course_name: course.name.clone(),
            content_id: item.id.clone(),
            attachment_id,
            relative_path: PathBuf::from(&dir).join(sanitize_path(&name)).to_string_lossy().into_owned(),
            file_name: name,
            url,
            webeep: false,
            stamp: item.modified.clone(),
        };
        let pending = (item.id.clone(), dir.clone(), item.modified.clone());

        // Ultra keeps document files as body links, never REST attachments (checked live:
        // those documents answer with an empty list), so a body with them skips the lookup.
        let body_files = item.body.as_deref().map(extract_ultra_files).unwrap_or_default();

        if handler == "resource/x-bb-file" {
            let name = item.content_handler.as_ref().and_then(|h| h["file"]["fileName"].as_str());
            match name {
                // The attachment id is resolved at download time.
                Some(name) => scan.files.push(file(name.to_string(), String::new(), None)),
                None => scan.pending.push(pending),
            }
        } else if body_files.is_empty() && may_have_attachments(handler) {
            scan.pending.push(pending);
        }

        for (name, url) in body_files {
            scan.files.push(file(name, String::new(), Some(url)));
        }
    }
    scan
}

const HTML_ENTITIES: &[(&str, char)] = &[
    ("&quot;", '"'),
    ("&amp;", '&'),
    ("&lt;", '<'),
    ("&gt;", '>'),
    ("&#39;", '\''),
    ("&apos;", '\''),
    ("&#x27;", '\''),
    ("&nbsp;", ' '),
];

/// Single pass, so a decoded `&amp;` is never re-read as the start of another entity.
fn html_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    loop {
        match rest.find('&') {
            None => {
                out.push_str(rest);
                return out;
            }
            Some(i) => {
                out.push_str(&rest[..i]);
                let tail = &rest[i..];
                match HTML_ENTITIES.iter().find(|(e, _)| tail.starts_with(e)) {
                    Some((e, c)) => {
                        out.push(*c);
                        rest = &tail[e.len()..];
                    }
                    None => {
                        out.push('&');
                        rest = &tail[1..];
                    }
                }
            }
        }
    }
}

fn attr_value<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let pattern = format!("{}=\"", name);
    let start = tag.find(&pattern)? + pattern.len();
    let len = tag[start..].find('"')?;
    Some(&tag[start..start + len])
}

/// (name, URL) of each file in an Ultra body: tags whose `data-bbfile` holds HTML-escaped
/// JSON. The tag's href, raw HTML, is the fallback when `resourceUrl` is missing.
fn extract_ultra_files(body: &str) -> Vec<(String, String)> {
    let mut files = Vec::new();

    for chunk in body.split("data-bbfile=\"").skip(1) {
        let Some(value_end) = chunk.find('"') else { continue };
        let meta: serde_json::Value = match serde_json::from_str(&html_unescape(&chunk[..value_end])) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let mut name = meta["linkName"]
            .as_str()
            .or_else(|| meta["displayName"].as_str())
            .unwrap_or_default();
        // A renamed link can drop the extension; fileName still has it.
        if !name.contains('.') {
            name = meta["fileName"].as_str().unwrap_or(name);
        }
        if name.is_empty() {
            continue;
        }

        let tag_rest = &chunk[value_end..];
        let tag_rest = &tag_rest[..tag_rest.find('>').unwrap_or(tag_rest.len())];

        // Pasted files can keep the upload's temporary /sessions/ URL, which 404s once that
        // session ends; viewerUrl then holds the stored bbcswebdav copy.
        let Some(url) = [
            meta["resourceUrl"].as_str().map(str::to_string),
            attr_value(tag_rest, "href").map(html_unescape),
            meta["viewerUrl"].as_str().map(str::to_string),
        ]
        .into_iter()
        .flatten()
        .find(|u| u.starts_with("http") && !u.contains("/sessions/")) else {
            continue;
        };

        files.push((name.to_string(), url));
    }

    files
}

pub fn sanitize_path(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || (c.is_control() && !c.is_whitespace()) { '_' } else { c })
        .collect();
    let sanitized = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");

    // Separators are already gone: only an all-dots name can still escape.
    if sanitized.is_empty() || sanitized.chars().all(|c| c == '.') {
        return "_".to_string();
    }

    // Windows refuses device names as a stem, whatever the extension.
    let stem = sanitized.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        format!("_{}", sanitized)
    } else {
        sanitized
    }
}

/// Built from the full list so names don't shift when a course is switched off. On a clash
/// the older course (Bocconi, then lower id) keeps the name; the newer gets "(PoliMi)" or its code.
pub fn course_dirs(courses: &[Course], aliases: &HashMap<String, String>) -> HashMap<String, String> {
    let mut order: Vec<&Course> = courses.iter().collect();
    // (length, text) sorts same-format ids numerically.
    order.sort_by_key(|c| (webeep::is_webeep(&c.id), c.id.len(), c.id.as_str()));

    // Lowercased, as Windows and macOS folders ignore case. Value: held by WeBeep.
    let mut taken: HashMap<String, bool> = HashMap::new();
    let mut dirs = HashMap::new();
    for course in order {
        let name = aliases.get(&course.id).unwrap_or(&course.name);
        let is_webeep = webeep::is_webeep(&course.id);
        let mut dir = sanitize_path(name);
        if is_webeep && taken.get(&dir.to_lowercase()) == Some(&false) {
            dir = sanitize_path(&format!("{} (PoliMi)", name));
        }
        if taken.contains_key(&dir.to_lowercase()) {
            dir = sanitize_path(&format!("{} ({})", name, course.course_id));
        }
        taken.insert(dir.to_lowercase(), is_webeep);
        dirs.insert(course.id.clone(), dir);
    }
    dirs
}

/// Resolves `.` and `..` lexically, so it works on paths that don't exist yet.
pub fn normalize_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut components: Vec<Component> = Vec::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                match components.last() {
                    Some(Component::Normal(_)) => { components.pop(); }
                    _ => {} // Ignore `..` that would escape
                }
            }
            Component::CurDir => {} // Skip `.`
            other => components.push(other),
        }
    }
    components.iter().collect()
}

/// Compares canonical with canonical, or lexical with lexical when `path` can't be
/// canonicalized (not created yet), so a `\\?\` prefix never causes a mismatch.
pub fn is_inside_resolved(path: &Path, canon_base: Option<&Path>, lex_base: &Path) -> bool {
    match (path.canonicalize(), canon_base) {
        (Ok(resolved), Some(base)) => resolved.as_path() == base || resolved.starts_with(base),
        _ => {
            let resolved = normalize_path(path);
            resolved.as_path() == lex_base || resolved.starts_with(lex_base)
        }
    }
}

pub fn setup_auto_sync(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut handle = state.autosync_handle.lock().unwrap();

    if let Some(h) = handle.take() {
        h.abort();
    }

    let config = state.store.lock().unwrap().get_config();
    if !config.auto_sync { return; }

    let app_clone = app.clone();
    // Own task: aborting this loop must not kill a sync and leave `syncing` stuck.
    let start_sync = move || {
        let app = app_clone.clone();
        tauri::async_runtime::spawn(async move { trigger_sync(&app).await });
    };

    let new_handle = if config.auto_sync_interval == 0 {
        let time_str = config.auto_sync_scheduled_time.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                wait_until(next_scheduled_time(&time_str)).await;
                start_sync();
            }
        })
    } else {
        let mins = config.auto_sync_interval as u64;
        tauri::async_runtime::spawn(async move {
            let duration = tokio::time::Duration::from_secs(mins * 60);
            loop {
                tokio::time::sleep(duration).await;
                start_sync();
            }
        })
    };

    *handle = Some(new_handle);
}

/// Short steps on the wall clock: macOS stops the monotonic one during standby.
async fn wait_until(target: chrono::DateTime<chrono::Local>) {
    loop {
        let left = (target - chrono::Local::now()).to_std().unwrap_or_default();
        if left.is_zero() {
            return;
        }
        tokio::time::sleep(left.min(std::time::Duration::from_secs(60))).await;
    }
}

fn next_scheduled_time(time_str: &str) -> chrono::DateTime<chrono::Local> {
    let parts: Vec<u32> = time_str.split(':')
        .filter_map(|s| s.parse().ok())
        .collect();
    let hours = parts.first().copied().unwrap_or(0);
    let minutes = parts.get(1).copied().unwrap_or(0);

    let now = chrono::Local::now();
    let today = now.date_naive();

    let mut target = today
        .and_hms_opt(hours, minutes, 0)
        .and_then(|dt| dt.and_local_timezone(chrono::Local).single())
        .unwrap_or_else(|| now + chrono::Duration::hours(24));

    if target <= now {
        target = target + chrono::Duration::days(1);
    }
    target
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shapes taken from a real Ultra course body (course _97806_1).
    const WITH_RESOURCE_URL: &str = r#"<div data-layout-row="a"><div data-layout-column="b"><a data-bbid="bbml-editor-id_1" data-bbfile="{&quot;linkName&quot;:&quot;20563_Session02_Risk Mgm &amp; Assess.pdf&quot;,&quot;displayName&quot;:&quot;20563_Session02_Risk Mgm &amp; Assess.pdf&quot;,&quot;mimeType&quot;:&quot;application/pdf&quot;,&quot;resourceUrl&quot;:&quot;https://bb.example/bbcswebdav/pid-1/xid-1?u=x&amp;exp=1&quot;}" href="https://bb.example/bbcswebdav/pid-1/xid-1?u=x&amp;exp=1"></a></div></div>"#;

    // Some items carry only viewerUrl, so the href is the download URL.
    const HREF_ONLY: &str = r#"<a data-bbfile="{&quot;linkName&quot;:&quot;An Incredible History.pdf&quot;,&quot;viewerUrl&quot;:&quot;https://bb.example/x?render=inline&quot;}" href="https://bb.example/bbcswebdav/pid-2/xid-2?u=x&amp;exp=1"></a>"#;

    #[test]
    fn extracts_name_and_url_from_resource_url() {
        let files = extract_ultra_files(WITH_RESOURCE_URL);
        assert_eq!(files.len(), 1);
        // The ampersand must survive both the entity decode and the JSON parse.
        assert_eq!(files[0].0, "20563_Session02_Risk Mgm & Assess.pdf");
        assert_eq!(files[0].1, "https://bb.example/bbcswebdav/pid-1/xid-1?u=x&exp=1");
    }

    #[test]
    fn falls_back_to_href_when_resource_url_missing() {
        let files = extract_ultra_files(HREF_ONLY);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].0, "An Incredible History.pdf");
        assert_eq!(files[0].1, "https://bb.example/bbcswebdav/pid-2/xid-2?u=x&exp=1");
    }

    const STALE_SESSION_URL: &str = r#"<a data-bbfile="{&quot;linkName&quot;:&quot;LOS NÚMEROS&quot;,&quot;fileName&quot;:&quot;LOS NÚMEROS.pdf&quot;,&quot;resourceUrl&quot;:&quot;https://bb.example/sessions/88/abc/LOS.pdf&quot;,&quot;viewerUrl&quot;:&quot;https://bb.example/bbcswebdav/pid-3/xid-3&quot;}" href="https://bb.example/sessions/88/abc/LOS.pdf"></a>"#;

    #[test]
    fn skips_expired_upload_session_urls() {
        assert_eq!(
            extract_ultra_files(STALE_SESSION_URL),
            vec![(
                "LOS NÚMEROS.pdf".to_string(),
                "https://bb.example/bbcswebdav/pid-3/xid-3".to_string()
            )]
        );
    }

    #[test]
    fn ignores_bodies_without_bbfile_links() {
        // Original-course bodies have plain links; those courses stay on the attachment path.
        let body = r#"<p>See <a href="https://bb.example/webapps/blackboard/thing">the notes</a>.</p>"#;
        assert!(extract_ultra_files(body).is_empty());
    }

    #[test]
    fn skips_malformed_payloads_without_dropping_valid_ones() {
        let body = format!(r#"<a data-bbfile="not json"></a>{}"#, HREF_ONLY);
        let files = extract_ultra_files(&body);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].0, "An Incredible History.pdf");
    }

    #[test]
    fn sanitize_handles_windows_invalid_names() {
        assert_eq!(sanitize_path("con.pdf"), "_con.pdf");
        assert_eq!(sanitize_path("LPT1"), "_LPT1");
        assert_eq!(sanitize_path("Console.pdf"), "Console.pdf");
        assert_eq!(sanitize_path("a\u{7}b\nc"), "a_b c");
        assert_eq!(sanitize_path("Slides..pdf"), "Slides..pdf");
        assert_eq!(sanitize_path(" .. "), "_");
        assert_eq!(sanitize_path("../x"), ".._x");
    }

    #[tokio::test]
    async fn save_response_is_all_or_nothing() {
        let dir = std::env::temp_dir().join(format!("bbsync-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("notes.pdf");
        let part = dir.join("notes.pdf.part");
        let response = || reqwest::Response::from(tauri::http::Response::new("hello".to_string()));

        let abort = std::sync::atomic::AtomicBool::new(true);
        assert!(save_response(response(), &path, &abort, None).await.is_err());
        assert!(!path.exists() && !part.exists());

        abort.store(false, Ordering::SeqCst);
        assert_eq!(save_response(response(), &path, &abort, None).await, Ok(true));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");
        assert!(!part.exists());
        #[cfg(windows)]
        {
            let ads = format!("{}:Zone.Identifier", path.display());
            assert!(std::fs::read_to_string(ads).unwrap().contains("ZoneId=3"));
        }

        // Same bytes under a new stamp: no new version.
        let v2 = dir.join("notes (v2).pdf");
        assert_eq!(save_response(response(), &v2, &abort, Some(&path)).await, Ok(false));
        assert!(!v2.exists() && !dir.join("notes (v2).pdf.part").exists());
        let changed = reqwest::Response::from(tauri::http::Response::new("hello!".to_string()));
        assert_eq!(save_response(changed, &v2, &abort, Some(&path)).await, Ok(true));
        assert_eq!(std::fs::read_to_string(&v2).unwrap(), "hello!");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Live timing of the scan phase against the real accounts stored in the
    /// keyring. Run with `cargo test --release bench_scan -- --ignored --nocapture`.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn bench_scan() {
        let store = crate::store::AppStore::new();
        let config = store.get_config();
        let t = std::time::Instant::now();

        let mut courses: Vec<Course> = Vec::new();
        let mut bb = None;
        if let Some(cookies) = store.load_session() {
            let mut api = BlackboardAPI::new(&cookies);
            let user = match api.get_current_user().await {
                Ok(u) => u,
                Err(_) => {
                    let (u, p) = store.load_credentials().expect("credenziali");
                    let r = LoginManager::new().login(&u, &p).await;
                    api = BlackboardAPI::new(&r.cookies);
                    api.get_current_user().await.expect("login")
                }
            };
            courses.extend(api.get_courses_for_sync(&user.id).await.unwrap());
            bb = Some(api);
        }
        let mut wb = None;
        if let Some(token) = store.load_webeep_token() {
            let api = webeep::WeBeepAPI::new(&token);
            let info = api.site_info().await.unwrap();
            courses.extend(webeep::get_courses(&api, info.userid).await.unwrap());
            wb = Some(api);
        }
        courses.retain(|c| config.sync_all_courses || config.enabled_courses.contains(&c.id));
        courses.retain(|c| !config.hidden_courses.contains(&c.id));
        courses.retain(|c| c.term.as_ref().map(|t| !config.hidden_terms.contains(&t.id)).unwrap_or(true));
        println!("login + corsi: {:?} ({} corsi)", t.elapsed(), courses.len());

        let abort = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let t = std::time::Instant::now();
        let scans = courses.iter().map(|c| {
            let (bb, wb, abort) = (bb.clone(), wb.clone(), abort.clone());
            async move {
                let t = std::time::Instant::now();
                let files = if webeep::is_webeep(&c.id) {
                    webeep::scan_course(wb.as_ref().unwrap(), c, &c.name).await
                } else {
                    scan_course(bb.as_ref().unwrap(), c, &c.name, &abort).await.map(|(f, _)| f)
                };
                (c.name.clone(), files.map_or(0, |f| f.len()), t.elapsed())
            }
        });
        let results = futures_util::future::join_all(scans).await;
        for (name, n, d) in &results {
            println!("  {:>7.2?}  {:>4} file  {}", d, n, name);
        }
        let total: usize = results.iter().map(|r| r.1).sum();
        println!("scansione: {:?} ({} file)", t.elapsed(), total);
    }

    /// Shapes from a live `?recursive=true` listing; top-level items point at the absent root.
    #[test]
    fn rebuilds_folders_from_a_flat_listing() {
        let items: Vec<ContentItem> = serde_json::from_str(r#"[
            {"id":"f1","title":"Week 1","parentId":"root","contentHandler":{"id":"resource/x-bb-folder"}},
            {"id":"f2","title":"Slides","parentId":"f1","contentHandler":{"id":"resource/x-bb-folder"}},
            {"id":"a","title":"Syllabus -pdf","parentId":"root","contentHandler":{"id":"resource/x-bb-file","file":{"fileName":"syllabus.pdf"}}},
            {"id":"b","title":"Lecture","parentId":"f2","contentHandler":{"id":"resource/x-bb-file","file":{"fileName":"l1.pdf"}}},
            {"id":"d","title":"Notes","parentId":"f1","contentHandler":{"id":"resource/x-bb-document"},
             "body":"<a data-bbfile=\"{&quot;linkName&quot;:&quot;n.pdf&quot;,&quot;resourceUrl&quot;:&quot;https://bb.example/bbcswebdav/n&quot;}\"></a>"},
            {"id":"l","title":"Quiz","parentId":"f1","contentHandler":{"id":"resource/x-bb-asmt-test-link"}},
            {"id":"o","title":"Readme","parentId":"root","contentHandler":{"id":"resource/x-bb-document"},"body":"<p>text</p>"}
        ]"#).unwrap();
        let course = Course {
            id: "c".into(), course_id: "C".into(), name: "C".into(), term: None, instructor: None,
        };

        let scan = files_from_contents(&items, &course, "Corso");
        let mut paths: Vec<String> =
            scan.files.iter().map(|f| f.relative_path.replace('\\', "/")).collect();
        paths.sort();
        // A document's body files sit beside the document, not inside it.
        assert_eq!(paths, ["Corso/Week 1/Slides/l1.pdf", "Corso/Week 1/n.pdf", "Corso/syllabus.pdf"]);
        // Only a document without body files can hide REST attachments.
        let pending: Vec<&str> = scan.pending.iter().map(|(id, _, _)| id.as_str()).collect();
        assert_eq!(pending, ["o"]);
    }

    #[test]
    fn unescape_is_single_pass() {
        assert_eq!(html_unescape("a&amp;quot;b"), "a&quot;b");
        assert_eq!(html_unescape("&lt;p&gt;x&#39;y&lt;/p&gt;"), "<p>x'y</p>");
    }

    fn course(id: &str, course_id: &str, name: &str) -> Course {
        Course { id: id.into(), course_id: course_id.into(), name: name.into(), term: None, instructor: None }
    }

    #[test]
    fn clashing_course_names_get_their_own_folders() {
        // Newest first: the older course must still keep the plain name.
        let courses = [
            course("webeep:10", "IOT-27", "INTERNET OF THINGS"),
            course("webeep:9", "IOT-26", "INTERNET OF THINGS"),
            course("webeep:5", "FIN", "Finance"),
            course("_200_1", "FIN-BB", "FINANCE"),
            course("_300_1", "MKT", "Marketing"),
        ];
        let aliases = HashMap::from([("_300_1".to_string(), "Mio corso".to_string())]);
        let dirs = course_dirs(&courses, &aliases);
        assert_eq!(dirs["webeep:9"], "INTERNET OF THINGS");
        assert_eq!(dirs["webeep:10"], "INTERNET OF THINGS (IOT-27)");
        // Folders ignore case, so "Finance" clashes with the Bocconi "FINANCE".
        assert_eq!(dirs["_200_1"], "FINANCE");
        assert_eq!(dirs["webeep:5"], "Finance (PoliMi)");
        assert_eq!(dirs["_300_1"], "Mio corso");
    }

    #[test]
    fn same_named_files_of_different_items_do_not_collide() {
        let items: Vec<ContentItem> = serde_json::from_str(r#"[
            {"id":"f","title":"Week 3","parentId":"root","contentHandler":{"id":"resource/x-bb-folder"}},
            {"id":"a","title":"Lecture A","parentId":"f","contentHandler":{"id":"resource/x-bb-file","file":{"fileName":"slides.pdf"}}},
            {"id":"b","title":"Lecture B","parentId":"f","contentHandler":{"id":"resource/x-bb-file","file":{"fileName":"slides.pdf"}}},
            {"id":"d","title":"Notes","parentId":"f","contentHandler":{"id":"resource/x-bb-document"},
             "body":"<a data-bbfile=\"{&quot;linkName&quot;:&quot;n.pdf&quot;,&quot;resourceUrl&quot;:&quot;https://bb.example/n&quot;}\"></a><a data-bbfile=\"{&quot;linkName&quot;:&quot;n.pdf&quot;,&quot;resourceUrl&quot;:&quot;https://bb.example/n&quot;}\"></a>"}
        ]"#).unwrap();
        let mut files = files_from_contents(&items, &course("c", "C", "C"), "Corso").files;
        separate_clashes(&mut files, &items);
        let mut paths: Vec<String> = files.iter().map(|f| f.relative_path.replace('\\', "/")).collect();
        paths.sort();
        // A file linked twice by one item is a repeat, not a clash.
        assert_eq!(paths, [
            "Corso/Week 3/Lecture A/slides.pdf",
            "Corso/Week 3/Lecture B/slides.pdf",
            "Corso/Week 3/n.pdf",
            "Corso/Week 3/n.pdf",
        ]);
    }

    #[test]
    fn versioned_names_keep_the_extension() {
        assert_eq!(versioned_path("C/slides.pdf", 1), "C/slides.pdf");
        assert_eq!(
            versioned_path("C/slides.pdf", 2).replace('\\', "/"),
            "C/slides (v2).pdf"
        );
        assert_eq!(versioned_path("README", 3), "README (v3)");
    }

    #[test]
    fn next_scheduled_time_is_within_a_day() {
        let now = chrono::Local::now();
        let next = next_scheduled_time("00:00");
        assert!(next > now && next <= now + chrono::Duration::days(1));
    }
}
