use crate::blackboard::BlackboardAPI;
use crate::download::{setup_auto_sync, trigger_sync};
use crate::login::LoginManager;
use crate::state::{AppState, Session};
use crate::webeep;
use crate::tray;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize)]
pub struct LoginResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<crate::blackboard::UserInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Either account may be absent (connecting just one is normal), hence no `success` flag.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsResponse {
    pub bocconi: Option<crate::blackboard::UserInfo>,
    pub webeep: Option<crate::blackboard::UserInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bocconi_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webeep_error: Option<String>,
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

#[tauri::command]
pub async fn login(
    username: String,
    password: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<LoginResponse, String> {
    if username.is_empty() || password.is_empty() {
        return Ok(LoginResponse {
            success: false,
            user: None,
            error: Some("Credenziali non valide".to_string()),
        });
    }
    if username.len() > 256 || password.len() > 256 {
        return Ok(LoginResponse {
            success: false,
            user: None,
            error: Some("Credenziali troppo lunghe".to_string()),
        });
    }

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
            state.store.lock().unwrap().save_session(&cookies);
            Ok(LoginResponse { success: true, user: Some(user), error: None })
        }
        Err(e) => Ok(LoginResponse {
            success: false,
            user: None,
            error: Some(format!("Login riuscito ma impossibile ottenere il profilo: {}", e)),
        }),
    }
}

/// Stored cookies first, then a SAML re-auth with the stored credentials.
async fn restore_blackboard(state: &AppState) -> Result<crate::blackboard::UserInfo, String> {
    let stored_session = state.store.lock().unwrap().load_session();
    if let Some(cookies) = stored_session {
        let api = BlackboardAPI::new(&cookies);
        if let Ok(user) = api.get_current_user().await {
            *state.session.lock().unwrap() = Some(Session { cookies });
            return Ok(user);
        }
        state.store.lock().unwrap().clear_session();
    }

    let creds = state.store.lock().unwrap().load_credentials();
    let Some((username, password)) = creds else {
        return Err("no-credentials".to_string());
    };

    let mut manager = LoginManager::new();
    let result = manager.login(&username, &password).await;
    if !result.success {
        return Err(result.error.unwrap_or_else(|| "Sessione scaduta".to_string()));
    }

    let cookies = result.cookies;
    let api = BlackboardAPI::new(&cookies);
    let user = api
        .get_current_user()
        .await
        .map_err(|_| "Sessione scaduta".to_string())?;

    *state.session.lock().unwrap() = Some(Session { cookies: cookies.clone() });
    state.store.lock().unwrap().save_session(&cookies);
    Ok(user)
}

/// Any HTTP answer from any of the hosts counts as online.
async fn is_online(urls: &[&str]) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    else {
        return true;
    };
    let probes = urls.iter().map(|u| client.head(*u).send());
    futures_util::future::join_all(probes).await.iter().any(|r| r.is_ok())
}

/// Restores every connected account at startup and starts the optional startup sync.
#[tauri::command]
pub async fn auto_login(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AccountsResponse, String> {
    // Autostart often runs before Wi-Fi is up: the UI shows an offline screen and retries,
    // instead of the login screen a failed restore would bring.
    let hosts = {
        let store = state.store.lock().unwrap();
        let mut hosts = Vec::new();
        if store.load_credentials().is_some() {
            hosts.push("https://blackboard.unibocconi.it");
        }
        if store.load_webeep_token().is_some() {
            hosts.push("https://webeep.polimi.it");
        }
        hosts
    };
    if !hosts.is_empty() && !is_online(&hosts).await {
        return Err("offline".to_string());
    }

    let (bocconi, bocconi_error) = match restore_blackboard(&state).await {
        Ok(user) => (Some(user), None),
        Err(e) => (None, Some(e)),
    };

    // A paused PoliMi account is still signed in, so Settings can name it.
    let (webeep_user, webeep_error) = match webeep::connected_api(&app).await {
        Ok(None) => (None, None),
        Ok(Some((_, info))) => (Some(webeep::user_info(&info)), None),
        Err(e) => (None, Some(e)),
    };

    if bocconi.is_some() || webeep_user.is_some() {
        let already_launched = state.has_completed_first_launch.swap(true, Ordering::SeqCst);
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
    }

    Ok(AccountsResponse { bocconi, webeep: webeep_user, bocconi_error, webeep_error })
}

/// Only the Moodle token is stored; the Polimi password never reaches this process.
#[tauri::command]
pub async fn webeep_login(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<LoginResponse, String> {
    let token = match webeep::acquire_token(&app).await {
        Ok(t) => t,
        Err(e) => return Ok(LoginResponse { success: false, user: None, error: Some(e) }),
    };

    // Only persist a token that actually authenticates.
    let api = webeep::WeBeepAPI::new(&token);
    match api.site_info().await {
        Ok(info) => {
            let mut store = state.store.lock().unwrap();
            store.save_webeep_token(&token);
            // A fresh connection starts switched on, whatever it was before.
            store.update_config(serde_json::json!({ "webeepEnabled": true }));
            Ok(LoginResponse {
                success: true,
                user: Some(webeep::user_info(&info)),
                error: None,
            })
        }
        Err(e) => Ok(LoginResponse { success: false, user: None, error: Some(e) }),
    }
}

/// One university, or both without `provider`. Auto-sync stops only once no account is left.
#[tauri::command]
pub async fn logout(
    state: State<'_, AppState>,
    provider: Option<String>,
) -> Result<SimpleResponse, String> {
    let provider = provider.unwrap_or_else(|| "all".to_string());

    if provider == "all" || provider == "bocconi" {
        *state.session.lock().unwrap() = None;
        state.store.lock().unwrap().clear_credentials();
        state.store.lock().unwrap().clear_session();
    }
    if provider == "all" || provider == "webeep" {
        state.store.lock().unwrap().clear_webeep_token();
    }

    let bocconi_left = state.session.lock().unwrap().is_some();
    let webeep_left = state.store.lock().unwrap().load_webeep_token().is_some();

    if !bocconi_left && !webeep_left {
        state.has_completed_first_launch.store(false, Ordering::SeqCst);
        let mut handle = state.autosync_handle.lock().unwrap();
        if let Some(h) = handle.take() {
            h.abort();
        }
    }

    Ok(SimpleResponse { success: true, error: None })
}

/// Both universities in one list; a failing source goes in `error` without hiding the other.
#[tauri::command]
pub async fn get_courses(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<CoursesResponse, String> {
    let mut courses: Vec<crate::blackboard::Course> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut connected = false;

    let session = state.session.lock().unwrap().clone();
    if let Some(session) = session {
        connected = true;
        let api = BlackboardAPI::new(&session.cookies);
        match api.get_current_user().await {
            Ok(user) => match api.get_courses(&user.id).await {
                Ok(list) => courses.extend(list),
                Err(e) => errors.push(format!("Bocconi: {}", e)),
            },
            Err(e) => errors.push(format!("Bocconi: {}", e)),
        }
    }

    match webeep::active_api(&app).await {
        Ok(None) => {}
        Ok(Some((api, info))) => {
            connected = true;
            match webeep::get_courses(&api, info.userid).await {
                Ok(list) => courses.extend(list),
                Err(e) => errors.push(format!("PoliMi: {}", e)),
            }
        }
        Err(e) => {
            connected = true;
            errors.push(format!("PoliMi: {}", e));
        }
    }

    if !connected {
        return Ok(CoursesResponse {
            success: false,
            courses: None,
            error: Some("Non autenticato".to_string()),
        });
    }

    Ok(CoursesResponse {
        success: !courses.is_empty() || errors.is_empty(),
        courses: Some(courses),
        error: (!errors.is_empty()).then(|| errors.join(" · ")),
    })
}

#[tauri::command]
pub async fn get_cached_instructors(
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, String> {
    Ok(state.store.lock().unwrap().load_instructors_cache())
}

#[tauri::command]
pub async fn get_instructors(
    state: State<'_, AppState>,
    course_ids: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    let session = state.session.lock().unwrap().clone();
    let Some(session) = session else {
        return Ok(HashMap::new());
    };
    // Moodle has no such endpoint, and Blackboard would 404 on WeBeep ids.
    let course_ids: Vec<String> = course_ids
        .into_iter()
        .filter(|id| !webeep::is_webeep(id))
        .collect();
    if course_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let api = BlackboardAPI::new(&session.cookies);
    let fresh = api.get_instructors(&course_ids).await;

    if !fresh.is_empty() {
        let mut cached = state.store.lock().unwrap().load_instructors_cache();
        for (k, v) in &fresh {
            cached.insert(k.clone(), v.clone());
        }
        state.store.lock().unwrap().save_instructors_cache(&cached);
    }

    Ok(fresh)
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

    if partial.get("autoSync").is_some()
        || partial.get("autoSyncInterval").is_some()
        || partial.get("autoSyncScheduledTime").is_some()
    {
        setup_auto_sync(&app);
    }

    if let Some(start) = partial["startAtLogin"].as_bool() {
        use tauri_plugin_autostart::ManagerExt;
        if start {
            let _ = app.autolaunch().enable();
        } else {
            let _ = app.autolaunch().disable();
        }
    }

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
    use crate::download::{is_inside_resolved, normalize_path};
    use tauri_plugin_opener::OpenerExt;

    let sync_dir = std::path::PathBuf::from(state.store.lock().unwrap().get_config().sync_dir);
    let requested = std::path::PathBuf::from(&folder_path);
    if !is_inside_resolved(&requested, sync_dir.canonicalize().ok().as_deref(), &normalize_path(&sync_dir)) {
        return Err("Path traversal non consentito".to_string());
    }

    let resolved = normalize_path(&requested);
    if !resolved.exists() {
        std::fs::create_dir_all(&resolved).map_err(|e| e.to_string())?;
    }
    if !resolved.is_dir() {
        return Err("Non è una cartella".to_string());
    }

    app.opener()
        .open_path(resolved.to_string_lossy(), None::<String>)
        .map_err(|e| e.to_string())
}

/// Opens a course's folder, or the sync root when it was never synced. Takes
/// the whole course list, which `course_dirs` needs to settle clashing names.
#[tauri::command]
pub async fn open_course_folder(
    course_id: String,
    courses: Vec<crate::blackboard::Course>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let config = state.store.lock().unwrap().get_config();
    let sync_dir = std::path::PathBuf::from(&config.sync_dir);
    let target = crate::download::course_dirs(&courses, &config.course_aliases)
        .get(&course_id)
        .map(|dir| sync_dir.join(dir))
        .filter(|dir| dir.is_dir())
        .unwrap_or(sync_dir);

    app.opener()
        .open_path(target.to_string_lossy(), None::<String>)
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
        crate::updater::check_for_updates(&app).await;
    });
    Ok(())
}

#[tauri::command]
pub async fn restart_for_update(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    state.is_quitting.store(true, Ordering::SeqCst);
    app.restart()
}
