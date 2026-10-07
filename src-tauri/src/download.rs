use crate::blackboard::{BlackboardAPI, ContentItem, Course, UserInfo};
use crate::login::LoginManager;
use crate::state::{AppState, Session};
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
    // Set for Ultra document files, which are signed bbcswebdav links in the
    // item body rather than REST attachments, and for every WeBeep file. None
    // means the Blackboard attachment path.
    pub url: Option<String>,
    // Which university this file came from: it selects the HTTP client used to
    // fetch it, since the two authenticate in completely different ways.
    pub webeep: bool,
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
    // One entry per university that could not be reached. With two sources a
    // partial failure is routine, so it is reported alongside the results
    // instead of aborting the whole sync.
    pub warnings: Vec<String>,
}

pub async fn trigger_sync(app: &AppHandle) {
    let state = app.state::<AppState>();

    // Either university on its own is enough to run a sync; only the case where
    // neither is connected is an error.
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

    // Prevent concurrent syncs
    if state.syncing.swap(true, Ordering::SeqCst) {
        return;
    }

    state.abort_flag.store(false, Ordering::SeqCst);
    app.emit("sync-start", ()).ok();

    let result = run_sync(app, session.as_ref()).await;

    match result {
        // Stopped by the user before anything arrived: no summary to show (it
        // would claim everything is up to date), and the last sync time stays
        // that of the last run that finished.
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

            // Notification if window hidden
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

/// Opens the Blackboard side of a sync: refreshes the session if needed and
/// lists the courses. Kept separate from `run_sync` so its failures can be
/// caught and turned into a warning instead of ending the whole sync.
async fn open_blackboard(
    app: &AppHandle,
    session: &Session,
) -> Result<(BlackboardAPI, Vec<Course>), String> {
    // The stored session cookie can expire between launch and sync. When it
    // does, Blackboard answers API calls with an HTML SAML login page instead
    // of JSON, and reqwest surfaces that as "error decoding response body".
    // Validate the session first and silently re-authenticate with the stored
    // credentials if it has lapsed, so a routine sync doesn't fail with a
    // cryptic decode error.
    let (api, user) = ensure_valid_session(app, session).await?;
    let courses = api.get_courses_for_sync(&user.id).await?;
    Ok((api, courses))
}

async fn run_sync(app: &AppHandle, session: Option<&Session>) -> Result<SyncResult, String> {
    let state = app.state::<AppState>();
    let config = state.store.lock().unwrap().get_config();
    let abort_flag = Arc::clone(&state.abort_flag);
    let start = std::time::Instant::now();

    // Each university is opened independently. One being unreachable downgrades
    // to a warning so the other still syncs — with two accounts, a partial
    // outage is the common case, not an exceptional one.
    let mut warnings: Vec<String> = Vec::new();

    // The two universities share nothing, so their logins and course lists are
    // fetched side by side rather than one after the other.
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

    // Filter courses
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

    // Scan phase — all courses in parallel
    let total_courses = courses.len() as u64;
    let scanned_count = Arc::new(std::sync::atomic::AtomicU64::new(0));

    // WeBeep courses now sit at the sync root beside the Blackboard ones, so two
    // universities offering a course with the same name would write into the
    // same folder. The Blackboard name wins, because its folder already exists
    // on disk and renaming it would re-download that whole archive.
    let blackboard_dirs: HashSet<String> = courses
        .iter()
        .filter(|c| !webeep::is_webeep(&c.id))
        .map(|c| {
            sanitize_path(config.course_aliases.get(&c.id).unwrap_or(&c.name))
        })
        .collect();

    let scan_handles: Vec<_> = courses.iter().map(|course| {
        let bb_api = bb_source.as_ref().map(|(api, _)| api.clone());
        let wb_api = wb_source.as_ref().map(|(api, _)| api.clone());
        let course = course.clone();
        let abort = Arc::clone(&abort_flag);
        let app_h = app.clone();
        let alias = config.course_aliases.get(&course.id)
            .cloned()
            .unwrap_or_else(|| course.name.clone());
        let dir = sanitize_path(&alias);
        let base = if webeep::is_webeep(&course.id) && blackboard_dirs.contains(&dir) {
            sanitize_path(&format!("{} (PoliMi)", alias))
        } else {
            dir
        };
        let counter = Arc::clone(&scanned_count);

        tokio::spawn(async move {
            let files = if webeep::is_webeep(&course.id) {
                match wb_api {
                    Some(api) => webeep::scan_course(&api, &course, &base).await,
                    None => Vec::new(),
                }
            } else {
                match bb_api {
                    Some(api) => scan_course(&api, &course, &base, &abort).await,
                    None => Vec::new(),
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

    // Note: scan tasks are already spawned above; each checks `abort_flag`
    // internally and returns early, so join completes promptly on abort.
    let scan_results = futures_util::future::join_all(scan_handles).await;
    let mut all_files: Vec<FileToDownload> = Vec::new();
    for result in scan_results {
        if let Ok(files) = result {
            all_files.extend(files);
        }
    }

    let mut seen_paths: HashSet<String> = HashSet::new();
    all_files.retain(|f| seen_paths.insert(f.relative_path.clone()));

    let sync_dir = PathBuf::from(&config.sync_dir);
    // Resolve the base once; re-canonicalizing per file is a wasted syscall.
    let canon_base = sync_dir.canonicalize().ok();
    let lex_base = normalize_path(&sync_dir);

    let to_download: Vec<FileToDownload> = all_files.iter()
        .filter(|f| {
            let full = sync_dir.join(&f.relative_path);
            is_inside_resolved(&full, canon_base.as_deref(), &lex_base) && !full.exists()
        })
        .cloned()
        .collect();

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

    // Download phase. Measured on a live 83-file / 119 MB sync: 3 workers took
    // 6.1 s, 8 took 2.7 s, 12 took 2.1 s — past 8 the gain no longer justifies
    // the extra load on the university servers.
    let total_dl = to_download.len() as u64;
    let queue = Arc::new(tokio::sync::Mutex::new(VecDeque::from(to_download)));
    let downloaded_count = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let failed_files: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
    let downloaded_files: Arc<tokio::sync::Mutex<Vec<FileToDownload>>> =
        Arc::new(tokio::sync::Mutex::new(Vec::new()));

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
        let failed = Arc::clone(&failed_files);
        let dl_files = Arc::clone(&downloaded_files);

        let h = tokio::spawn(async move {
            loop {
                if abort.load(Ordering::SeqCst) { break; }

                let file = {
                    let mut q = queue.lock().await;
                    q.pop_front()
                };
                let file = match file { Some(f) => f, None => break };

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

                        let full_path = sync_dir.join(&file.relative_path);
                        if !is_inside_resolved(&full_path, canon_base.as_deref(), &lex_base) { continue; }

                        if let Some(dir) = full_path.parent() {
                            let _ = tokio::fs::create_dir_all(dir).await;
                        }
                        if let Err(e) = save_response(response, &full_path, &abort).await {
                            eprintln!("Download failed for {}: {}", file.file_name, e);
                            if !abort.load(Ordering::SeqCst) {
                                failed.lock().unwrap().push(format!("{} ({})", file.file_name, e));
                            }
                        } else {
                            let count = dl_count.fetch_add(1, Ordering::SeqCst) + 1;
                            dl_files.lock().await.push(file.clone());
                            app_h.emit("sync-progress", SyncProgressPayload {
                                phase: "downloading".to_string(),
                                current: count,
                                total: total_dl,
                                current_file: Some(file.file_name.clone()),
                                error: None,
                            }).ok();
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

    // Build per-course result
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

/// Ensure the session cookies still authenticate. If a quick `/users/me`
/// probe fails (expired cookie → HTML login page → JSON decode error), try a
/// full SAML re-auth with the stored credentials, persist the refreshed
/// session, and return it. Errors only if no credentials are stored or the
/// re-auth itself fails, in which case the user must log in again.
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

/// Writes to `<path>.part`, renamed only when complete: sync skips existing
/// files, so a truncated one would never be fetched again.
async fn save_response(
    response: reqwest::Response,
    path: &Path,
    abort: &std::sync::atomic::AtomicBool,
) -> Result<(), String> {
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
        tokio::fs::rename(&part, path).await.map_err(|e| e.to_string())?;
        mark_as_downloaded(path).await;
        Ok(())
    }
    .await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&part).await;
    }
    result
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

/// Handlers whose items can hold attachments that only `/attachments` reveals.
/// Folders and links never do, and a file item names its one attachment in
/// its own `contentHandler`, so asking for any of those would be a round-trip
/// for nothing.
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
) -> Vec<FileToDownload> {
    let Ok(items) = api.get_all_contents(&course.id).await else {
        return Vec::new();
    };
    let lookups = files_from_contents(&items, course, base_path);

    // Only the items that may hide REST attachments cost a request now.
    const CONCURRENCY: usize = 6;
    let fetched: Vec<Vec<FileToDownload>> = futures_util::stream::iter(lookups.pending)
        .map(|(item_id, dir)| async move {
            if abort_flag.load(Ordering::SeqCst) {
                return Vec::new();
            }
            let attachments = api.get_attachments(&course.id, &item_id).await.unwrap_or_default();
            attachments
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
                })
                .collect()
        })
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await;

    let mut files = lookups.files;
    files.extend(fetched.into_iter().flatten());
    files
}

struct ContentScan {
    /// Files known from the listing alone.
    files: Vec<FileToDownload>,
    /// (item id, folder) for items whose attachments still need asking for.
    pending: Vec<(String, String)>,
}

/// Lays out a course's files from its flat, recursive content listing. Split
/// from the network call so the tree rebuild can be tested against fixtures.
fn files_from_contents(items: &[ContentItem], course: &Course, base_path: &str) -> ContentScan {
    let by_id: HashMap<&str, &ContentItem> = items.iter().map(|i| (i.id.as_str(), i)).collect();

    // An item's folder is the chain of its ancestors' titles. The course root
    // is not part of the listing, so the walk stops at the first unknown
    // parent; the depth cap guards against a malformed parent cycle.
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
        };

        // Ultra keeps a document's files as links in its body, never as REST
        // attachments (checked live: every such document answers with an
        // empty list), so a body carrying them spares the lookup.
        let body_files = item.body.as_deref().map(extract_ultra_files).unwrap_or_default();

        if handler == "resource/x-bb-file" {
            let name = item.content_handler.as_ref().and_then(|h| h["file"]["fileName"].as_str());
            match name {
                // The attachment id is resolved at download time.
                Some(name) => scan.files.push(file(name.to_string(), String::new(), None)),
                None => scan.pending.push((item.id.clone(), dir.clone())),
            }
        } else if body_files.is_empty() && may_have_attachments(handler) {
            scan.pending.push((item.id.clone(), dir.clone()));
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

/// Single left-to-right pass, so a decoded `&amp;` is never re-read as the
/// start of another entity.
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

/// Pull downloadable files out of an Ultra document body. Each file is an
/// anchor or image carrying a `data-bbfile` attribute whose value is
/// HTML-escaped JSON, so URLs inside it come out clean once the attribute is
/// unescaped; the tag's own href is still raw HTML and needs its own pass.
/// `resourceUrl` is missing on some items, and then href is the download URL.
/// Returns (file name, absolute URL).
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

        // Files pasted into the editor can keep the upload's temporary
        // /sessions/ URL as resourceUrl (and href), which 404s once that
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
    let sanitized = sanitized.trim().to_string();

    // Strip path traversal components (defense in depth)
    let sanitized = sanitized.replace("..", "");
    let sanitized = sanitized.trim().to_string();

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

/// Normalize a path lexically by resolving `.` and `..` components
/// without touching the filesystem (works on paths that don't exist yet).
fn normalize_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut components: Vec<Component> = Vec::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                // Only pop if the last component is a normal dir, never pop past root/prefix
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

/// Containment check against a pre-resolved sync dir. `canon_base` is the
/// canonicalized sync dir (None if it couldn't be canonicalized); `lex_base`
/// is its lexical normalization, used when the path can't be canonicalized
/// (e.g. it doesn't exist yet). Comparing canonical-vs-canonical or
/// lexical-vs-lexical keeps both sides consistent (no \\?\ prefix mismatch).
fn is_inside_resolved(path: &Path, canon_base: Option<&Path>, lex_base: &Path) -> bool {
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

    let new_handle = if config.auto_sync_interval == 0 {
        let time_str = config.auto_sync_scheduled_time.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let delay = next_scheduled_delay(&time_str);
                tokio::time::sleep(delay).await;
                trigger_sync(&app_clone).await;
            }
        })
    } else {
        let mins = config.auto_sync_interval as u64;
        tauri::async_runtime::spawn(async move {
            let duration = tokio::time::Duration::from_secs(mins * 60);
            loop {
                tokio::time::sleep(duration).await;
                trigger_sync(&app_clone).await;
            }
        })
    };

    *handle = Some(new_handle);
}

fn next_scheduled_delay(time_str: &str) -> std::time::Duration {
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

    let diff = (target - now).to_std().unwrap_or(std::time::Duration::from_secs(3600));
    diff
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
        // Original-course bodies have plain links and must keep yielding
        // nothing here, so those courses stay on the attachment path.
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
    }

    #[tokio::test]
    async fn save_response_is_all_or_nothing() {
        let dir = std::env::temp_dir().join(format!("bbsync-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("notes.pdf");
        let part = dir.join("notes.pdf.part");
        let response = || reqwest::Response::from(tauri::http::Response::new("hello".to_string()));

        let abort = std::sync::atomic::AtomicBool::new(true);
        assert!(save_response(response(), &path, &abort).await.is_err());
        assert!(!path.exists() && !part.exists());

        abort.store(false, Ordering::SeqCst);
        save_response(response(), &path, &abort).await.unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");
        assert!(!part.exists());
        #[cfg(windows)]
        {
            let ads = format!("{}:Zone.Identifier", path.display());
            assert!(std::fs::read_to_string(ads).unwrap().contains("ZoneId=3"));
        }

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
                    scan_course(bb.as_ref().unwrap(), c, &c.name, &abort).await
                };
                (c.name.clone(), files.len(), t.elapsed())
            }
        });
        let results = futures_util::future::join_all(scans).await;
        for (name, n, d) in &results {
            println!("  {:>7.2?}  {:>4} file  {}", d, n, name);
        }
        let total: usize = results.iter().map(|r| r.1).sum();
        println!("scansione: {:?} ({} file)", t.elapsed(), total);
    }

    /// Shapes taken from a live `?recursive=true` listing: top-level items
    /// point at the course root, which the listing itself does not contain.
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
        // Only a document without body files can hide REST attachments;
        // folders, files, links and Ultra bodies must not cost a request each.
        let pending: Vec<&str> = scan.pending.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(pending, ["o"]);
    }

    #[test]
    fn unescape_is_single_pass() {
        assert_eq!(html_unescape("a&amp;quot;b"), "a&quot;b");
        assert_eq!(html_unescape("&lt;p&gt;x&#39;y&lt;/p&gt;"), "<p>x'y</p>");
    }
}
