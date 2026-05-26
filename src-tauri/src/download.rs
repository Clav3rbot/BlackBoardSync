use crate::blackboard::{BlackboardAPI, ContentItem, Course};
use crate::state::{AppState, Session};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Emitter};

#[derive(Clone)]
struct FileToDownload {
    course_id: String,
    course_name: String,
    content_id: String,
    attachment_id: String,
    file_name: String,
    relative_path: String,
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
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub total_downloaded: u64,
    pub total_scanned: u64,
    pub courses: Vec<SyncResultCourse>,
    pub duration: u64,
}

pub async fn trigger_sync(app: &AppHandle) {
    let state = app.state::<AppState>();

    let session = {
        state.session.lock().unwrap().clone()
    };

    let Some(session) = session else {
        app.emit("sync-progress", SyncProgressPayload {
            phase: "error".to_string(),
            current: 0,
            total: 0,
            current_file: None,
            error: Some("Sessione non attiva. Rieffettua il login.".to_string()),
        }).ok();
        return;
    };

    // Prevent concurrent syncs
    if state.syncing.swap(true, Ordering::SeqCst) {
        return;
    }

    state.abort_flag.store(false, Ordering::SeqCst);
    app.emit("sync-start", ()).ok();

    let result = run_sync(app, &session).await;

    match result {
        Ok(sync_result) => {
            let config = state.store.lock().unwrap().get_config();
            {
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
                    let body = if sync_result.total_downloaded > 0 {
                        format!("Scaricati {} file nuovi", sync_result.total_downloaded)
                    } else {
                        "Nessun file nuovo trovato".to_string()
                    };
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

async fn run_sync(app: &AppHandle, session: &Session) -> Result<SyncResult, String> {
    let state = app.state::<AppState>();
    let config = state.store.lock().unwrap().get_config();
    let abort_flag = Arc::clone(&state.abort_flag);
    let start = std::time::Instant::now();

    let api = BlackboardAPI::new(&session.cookies);
    let user = api.get_current_user().await?;
    let all_courses = api.get_courses(&user.id).await?;

    // Filter courses
    let mut courses: Vec<Course> = if !config.enabled_courses.is_empty() {
        all_courses.into_iter()
            .filter(|c| config.enabled_courses.contains(&c.id))
            .collect()
    } else {
        all_courses
    };
    if !config.hidden_courses.is_empty() {
        courses.retain(|c| !config.hidden_courses.contains(&c.id));
    }
    if !config.hidden_terms.is_empty() {
        courses.retain(|c| {
            c.term.as_ref().map(|t| !config.hidden_terms.contains(&t.id)).unwrap_or(true)
        });
    }

    // Scan phase
    let total_courses = courses.len() as u64;
    let mut all_files: Vec<FileToDownload> = Vec::new();

    for (i, course) in courses.iter().enumerate() {
        if abort_flag.load(Ordering::SeqCst) {
            return Ok(SyncResult {
                total_downloaded: 0,
                total_scanned: 0,
                courses: vec![],
                duration: 0,
            });
        }

        app.emit("sync-progress", SyncProgressPayload {
            phase: "scanning".to_string(),
            current: (i + 1) as u64,
            total: total_courses,
            current_file: Some(course.name.clone()),
            error: None,
        }).ok();

        let alias = config.course_aliases.get(&course.id)
            .cloned()
            .unwrap_or_else(|| course.name.clone());
        let base = sanitize_path(&alias);

        let files = scan_course(&api, course, &base, &abort_flag).await;
        all_files.extend(files);
    }

    let sync_dir = PathBuf::from(&config.sync_dir);

    let to_download: Vec<FileToDownload> = all_files.iter()
        .filter(|f| {
            let full = sync_dir.join(&f.relative_path);
            is_inside_sync_dir(&full, &sync_dir) && !full.exists()
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
        });
    }

    // Download phase — 3 concurrent workers
    let total_dl = to_download.len() as u64;
    let queue = Arc::new(tokio::sync::Mutex::new(VecDeque::from(to_download)));
    let downloaded_count = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let downloaded_files: Arc<tokio::sync::Mutex<Vec<FileToDownload>>> =
        Arc::new(tokio::sync::Mutex::new(Vec::new()));

    let concurrency = 3usize.min(total_dl as usize);
    let mut handles = Vec::new();

    for _ in 0..concurrency {
        let queue = Arc::clone(&queue);
        let api = api.clone();
        let abort = Arc::clone(&abort_flag);
        let app_h = app.clone();
        let sync_dir = sync_dir.clone();
        let dl_count = Arc::clone(&downloaded_count);
        let dl_files = Arc::clone(&downloaded_files);

        let h = tokio::spawn(async move {
            loop {
                if abort.load(Ordering::SeqCst) { break; }

                let file = {
                    let mut q = queue.lock().await;
                    q.pop_front()
                };
                let file = match file { Some(f) => f, None => break };

                match api.download_file(&file.course_id, &file.content_id, &file.attachment_id).await {
                    Ok((data, _)) => {
                        if abort.load(Ordering::SeqCst) { break; }

                        let full_path = sync_dir.join(&file.relative_path);
                        if !is_inside_sync_dir(&full_path, &sync_dir) { continue; }

                        if let Some(dir) = full_path.parent() {
                            let _ = std::fs::create_dir_all(dir);
                        }
                        if std::fs::write(&full_path, &data).is_ok() {
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
    let dl_files = downloaded_files.lock().await;

    // Build per-course result
    let mut course_map: HashMap<String, SyncResultCourse> = HashMap::new();
    for f in dl_files.iter() {
        let entry = course_map.entry(f.course_id.clone()).or_insert_with(|| SyncResultCourse {
            course_name: f.course_name.clone(),
            files: vec![],
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
    })
}

async fn scan_course(
    api: &BlackboardAPI,
    course: &Course,
    base_path: &str,
    abort_flag: &Arc<std::sync::atomic::AtomicBool>,
) -> Vec<FileToDownload> {
    let mut files = Vec::new();
    let top_level = match api.get_contents(&course.id).await {
        Ok(c) => c,
        Err(_) => return files,
    };

    // Iterative DFS: (items, path, depth)
    let mut stack: Vec<(Vec<ContentItem>, String, usize)> = vec![(top_level, base_path.to_string(), 0)];
    let mut visited: HashSet<String> = HashSet::new();

    while let Some((items, path, depth)) = stack.pop() {
        if depth > 20 { continue; }

        for item in items {
            if abort_flag.load(Ordering::SeqCst) { return files; }

            if let Ok(attachments) = api.get_attachments(&course.id, &item.id).await {
                for att in attachments {
                    let rel = PathBuf::from(&path).join(sanitize_path(&att.file_name));
                    files.push(FileToDownload {
                        course_id: course.id.clone(),
                        course_name: course.name.clone(),
                        content_id: item.id.clone(),
                        attachment_id: att.id.clone(),
                        file_name: att.file_name.clone(),
                        relative_path: rel.to_string_lossy().into_owned(),
                    });
                }
            }

            if item.has_children.unwrap_or(false) && !visited.contains(&item.id) {
                visited.insert(item.id.clone());
                let folder = PathBuf::from(&path).join(sanitize_path(&item.title));
                if let Ok(children) = api.get_children(&course.id, &item.id).await {
                    stack.push((children, folder.to_string_lossy().into_owned(), depth + 1));
                }
            }
        }
    }

    files
}

pub fn sanitize_path(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let sanitized = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");
    let sanitized = sanitized.trim().to_string();

    // Strip path traversal components (defense in depth)
    let sanitized = sanitized.replace("..", "");
    let sanitized = sanitized.trim().to_string();

    if sanitized.is_empty() || sanitized.chars().all(|c| c == '.') {
        "_".to_string()
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

fn is_inside_sync_dir(path: &Path, sync_dir: &Path) -> bool {
    // Try filesystem-level canonicalization first (most accurate)
    let (resolved, base) = match (path.canonicalize(), sync_dir.canonicalize()) {
        (Ok(r), Ok(b)) => (r, b),
        _ => {
            // Fallback: lexical normalization (safe for non-existent paths)
            (normalize_path(path), normalize_path(sync_dir))
        }
    };
    resolved == base || resolved.starts_with(&base)
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
