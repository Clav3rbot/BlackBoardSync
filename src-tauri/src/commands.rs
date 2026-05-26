use crate::blackboard::BlackboardAPI;
use crate::download::{setup_auto_sync, trigger_sync};
use crate::login::LoginManager;
use crate::state::{AppState, Session};
use crate::tray;
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State};

// ── Response types ────────────────────────────────────────────

#[derive(Serialize)]
pub struct LoginResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<crate::blackboard::UserInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct CoursesResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub courses: Option<Vec<crate::blackboard::Course>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct SimpleResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn login(
    username: String,
    password: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<LoginResponse, String> {
    let mut manager = LoginManager::new();
    let result = manager.login(&username, &password).await;

    if !result.success {
        return Ok(LoginResponse {
            success: false,
            user: None,
            error: result.error,
        });
    }

    let cookies = result.cookies;
    let api = BlackboardAPI::new(&cookies);

    match api.get_current_user().await {
        Ok(user) => {
            {
                let mut session = state.session.lock().unwrap();
                *session = Some(Session { cookies: cookies.clone() });
            }
            state.store.lock().unwrap().save_credentials(&username, &password);
            Ok(LoginResponse { success: true, user: Some(user), error: None })
        }
        Err(e) => Ok(LoginResponse {
            success: false,
            user: None,
            error: Some(format!("Login riuscito ma impossibile ottenere il profilo: {}", e)),
        }),
    }
}

#[tauri::command]
pub async fn auto_login(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<LoginResponse, String> {
    let creds = state.store.lock().unwrap().load_credentials();
    let Some((username, password)) = creds else {
        return Ok(LoginResponse {
            success: false,
            user: None,
            error: Some("no-credentials".to_string()),
        });
    };

    let mut manager = LoginManager::new();
    let result = manager.login(&username, &password).await;

    if !result.success {
        return Ok(LoginResponse {
            success: false,
            user: None,
            error: result.error,
        });
    }

    let cookies = result.cookies;
    let api = BlackboardAPI::new(&cookies);

    match api.get_current_user().await {
        Ok(user) => {
            {
                let mut session = state.session.lock().unwrap();
                *session = Some(Session { cookies });
            }

            let already_launched =
                state.has_completed_first_launch.swap(true, Ordering::SeqCst);
            if !already_launched {
                let sync_on_startup = state.store.lock().unwrap().get_config().sync_on_startup;
                if sync_on_startup {
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                        trigger_sync(&app_clone).await;
                    });
                }
            }

            Ok(LoginResponse { success: true, user: Some(user), error: None })
        }
        Err(_) => Ok(LoginResponse {
            success: false,
            user: None,
            error: Some("Sessione scaduta".to_string()),
        }),
    }
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<SimpleResponse, String> {
    {
        let mut session = state.session.lock().unwrap();
        *session = None;
    }
    state.store.lock().unwrap().clear_credentials();
    state.has_completed_first_launch.store(false, Ordering::SeqCst);

    let mut handle = state.autosync_handle.lock().unwrap();
    if let Some(h) = handle.take() {
        h.abort();
    }

    Ok(SimpleResponse { success: true, error: None })
}

#[tauri::command]
pub async fn get_courses(state: State<'_, AppState>) -> Result<CoursesResponse, String> {
    let session = state.session.lock().unwrap().clone();
    let Some(session) = session else {
        return Ok(CoursesResponse {
            success: false,
            courses: None,
            error: Some("Non autenticato".to_string()),
        });
    };

    let api = BlackboardAPI::new(&session.cookies);
    match api.get_current_user().await {
        Ok(user) => match api.get_courses(&user.id).await {
            Ok(courses) => Ok(CoursesResponse { success: true, courses: Some(courses), error: None }),
            Err(e) => Ok(CoursesResponse { success: false, courses: None, error: Some(e) }),
        },
        Err(e) => Ok(CoursesResponse { success: false, courses: None, error: Some(e) }),
    }
}

#[tauri::command]
pub async fn sync(app: AppHandle) -> Result<SimpleResponse, String> {
    tauri::async_runtime::spawn(async move {
        trigger_sync(&app).await;
    });
    Ok(SimpleResponse { success: true, error: None })
}

#[tauri::command]
pub async fn abort_sync(state: State<'_, AppState>) -> Result<SimpleResponse, String> {
    state.abort_flag.store(true, Ordering::SeqCst);
    Ok(SimpleResponse { success: true, error: None })
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> crate::store::AppConfig {
    state.store.lock().unwrap().get_config()
}

#[tauri::command]
pub fn update_config(
    partial: serde_json::Value,
    state: State<'_, AppState>,
    app: AppHandle,
) -> crate::store::AppConfig {
    let old_config = state.store.lock().unwrap().get_config();
    let new_config = state.store.lock().unwrap().update_config(partial.clone());

    // Re-schedule auto-sync if relevant fields changed
    if partial.get("autoSync").is_some()
        || partial.get("autoSyncInterval").is_some()
        || partial.get("autoSyncScheduledTime").is_some()
    {
        setup_auto_sync(&app);
    }

    // Start-at-login
    if let Some(start) = partial["startAtLogin"].as_bool() {
        use tauri_plugin_autostart::ManagerExt;
        if start {
            let _ = app.autolaunch().enable();
        } else {
            let _ = app.autolaunch().disable();
        }
    }

    // Minimize to tray
    if let Some(minimize) = partial["minimizeToTray"].as_bool() {
        if minimize && !old_config.minimize_to_tray {
            let _ = tray::create_tray(&app);
        } else if !minimize && old_config.minimize_to_tray {
            let _ = app.remove_tray_by_id("main");
        }
    }

    new_config
}

#[tauri::command]
pub async fn select_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |result| {
        let _ = tx.send(result);
    });
    rx.await
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn open_folder(
    folder_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    use std::path::{Path, PathBuf};

    let sync_dir_str = state.store.lock().unwrap().get_config().sync_dir;
    let sync_dir = PathBuf::from(&sync_dir_str);
    let requested = PathBuf::from(&folder_path);

    let resolved = requested.canonicalize().unwrap_or(requested.clone());
    let base = sync_dir.canonicalize().unwrap_or(sync_dir.clone());

    if resolved != base && !resolved.starts_with(&base) {
        return Err("Path traversal non consentito".to_string());
    }

    if !resolved.exists() {
        std::fs::create_dir_all(&resolved).map_err(|e| e.to_string())?;
    }

    app.opener()
        .open_path(resolved.to_string_lossy(), None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_window_size(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_size(tauri::LogicalSize::new(480.0, 780.0))
            .map_err(|e| e.to_string())?;
        window.center().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        crate::updater::check_for_updates_internal(&app).await;
    });
    Ok(())
}

#[tauri::command]
pub async fn restart_for_update(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let path = state.pending_setup_path.lock().unwrap().clone();
    let Some(setup_path) = path else {
        return Err("Nessun aggiornamento in attesa".to_string());
    };

    if !std::path::Path::new(&setup_path).exists() {
        return Err("File installer non trovato".to_string());
    }

    std::process::Command::new(&setup_path)
        .spawn()
        .map_err(|e| e.to_string())?;

    state.is_quitting.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}
