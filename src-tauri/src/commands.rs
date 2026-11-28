use crate::blackboard::BlackboardAPI;
use crate::download::{setup_auto_sync, trigger_sync, Sources};
use crate::login::{sign_in, sign_in_again, SignInError};
use crate::state::{AppState, Session};
use crate::webeep;
use crate::tray;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};

#[derive(Serialize)]
pub struct LoginResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<crate::model::UserInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl From<Result<crate::model::UserInfo, String>> for LoginResponse {
    fn from(result: Result<crate::model::UserInfo, String>) -> Self {
        match result {
            Ok(user) => Self { success: true, user: Some(user), error: None },
            Err(e) => Self { success: false, user: None, error: Some(e) },
        }
    }
}

/// Either account may be absent (connecting just one is normal), hence no `success` flag.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsResponse {
    pub bocconi: Option<crate::model::UserInfo>,
    pub webeep: Option<crate::model::UserInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bocconi_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webeep_error: Option<String>,
}

#[derive(Serialize)]
pub struct CoursesResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub courses: Option<Vec<crate::model::Course>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct SimpleResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl SimpleResponse {
    pub const OK: Self = Self { success: true, error: None };
}

#[tauri::command]
pub async fn login(
    username: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<LoginResponse, String> {
    if username.is_empty() || password.is_empty() {
        return Ok(Err("Credenziali non valide".to_string()).into());
    }
    if username.len() > 256 || password.len() > 256 {
        return Ok(Err("Credenziali troppo lunghe".to_string()).into());
    }

    let result = match sign_in(&state, &username, &password).await {
        Ok((_, user)) => {
            state.store.lock().unwrap().save_credentials(&username, &password);
            Ok(user)
        }
        Err(SignInError::Rejected(e)) => Err(e),
        Err(SignInError::NoProfile(e)) => {
            Err(format!("Login riuscito ma impossibile ottenere il profilo: {}", e))
        }
    };
    Ok(result.into())
}

/// Stored cookies first, then a SAML re-auth with the stored credentials.
async fn restore_blackboard(state: &AppState) -> Result<crate::model::UserInfo, String> {
    let stored_session = state.store.lock().unwrap().load_session();
    if let Some(cookies) = stored_session {
        let api = BlackboardAPI::new(&cookies);
        if let Ok(user) = api.get_current_user().await {
            *state.session.lock().unwrap() = Some(Session { cookies });
            return Ok(user);
        }
        state.store.lock().unwrap().clear_session();
    }

    match sign_in_again(state).await {
        None => Err("no-credentials".to_string()),
        Some(Ok((_, user))) => Ok(user),
        Some(Err(SignInError::Rejected(e))) => Err(e),
        Some(Err(SignInError::NoProfile(_))) => Err("Sessione scaduta".to_string()),
    }
}

/// Any HTTP answer from any of the hosts counts as online.
async fn is_online(urls: &[&str]) -> bool {
    let Ok(client) = crate::http::client()
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
            hosts.push(crate::blackboard::SITE);
        }
        if store.load_webeep_token().is_some() {
            hosts.push(webeep::SITE);
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
    Ok(connect_webeep(&state, &app).await.into())
}

async fn connect_webeep(state: &AppState, app: &AppHandle) -> Result<crate::model::UserInfo, String> {
    let token = webeep::acquire_token(app).await?;
    // Only persist a token that actually authenticates.
    let info = webeep::WeBeepAPI::new(&token).site_info().await?;
    let mut store = state.store.lock().unwrap();
    store.save_webeep_token(&token);
    // A fresh connection starts switched on, whatever it was before.
    store.update_config(serde_json::json!({ "webeepEnabled": true }));
    Ok(webeep::user_info(&info))
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

    Ok(SimpleResponse::OK)
}

/// Both universities in one list; a failing source goes in `error` without hiding the other.
#[tauri::command]
pub async fn get_courses(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<CoursesResponse, String> {
    let session = state.session.lock().unwrap().clone();
    let sources = Sources::open(&app, session.as_ref(), true).await;
    Ok(courses_response(session.is_some(), &sources))
}

/// A university that failed still counts as connected: its error shows beside the other's courses.
fn courses_response(had_session: bool, sources: &Sources) -> CoursesResponse {
    let errors = &sources.errors;
    if !had_session && sources.webeep.is_none() && errors.is_empty() {
        return CoursesResponse {
            success: false,
            courses: None,
            error: Some("Non autenticato".to_string()),
        };
    }
    let courses = sources.courses();
    CoursesResponse {
        success: !courses.is_empty() || errors.is_empty(),
        courses: Some(courses),
        error: (!errors.is_empty()).then(|| errors.join(" · ")),
    }
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
    Ok(SimpleResponse::OK)
}

#[tauri::command]
pub async fn abort_sync(state: State<'_, AppState>) -> Result<SimpleResponse, String> {
    state.abort_flag.store(true, Ordering::SeqCst);
    Ok(SimpleResponse::OK)
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
            tray::remove(&app);
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
    use crate::paths::{normalize_path, SyncRoot};
    use tauri_plugin_opener::OpenerExt;

    let sync_dir = std::path::PathBuf::from(state.store.lock().unwrap().get_config().sync_dir);
    let requested = std::path::PathBuf::from(&folder_path);
    if !SyncRoot::new(&sync_dir).contains(&requested) {
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
    courses: Vec<crate::model::Course>,
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

/// Files moved or deleted since their sync can't be opened, so they drop out of the list.
/// Async so the folder walk of the first call runs off the main thread.
#[tauri::command]
pub async fn get_recent_downloads(state: State<'_, AppState>) -> Result<Vec<crate::store::RecentDownload>, String> {
    let (sync_dir, stored, stamps) = {
        let store = state.store.lock().unwrap();
        (
            std::path::PathBuf::from(store.get_config().sync_dir),
            store.load_recent_downloads(),
            store.load_file_stamps(),
        )
    };
    let list: Vec<_> = stored.into_iter().filter(|r| sync_dir.join(&r.path).is_file()).collect();
    if !list.is_empty() {
        return Ok(list);
    }
    // Nothing recorded yet, or the sync folder changed: start from what is on disk.
    let synced = crate::download::synced_paths(&stamps);
    let list = crate::download::recent_files_on_disk(&sync_dir, &synced, crate::store::RECENT_DOWNLOADS_MAX);
    state.store.lock().unwrap().add_recent_downloads(list.clone());
    Ok(list)
}

/// Opens a recently downloaded file, or with `reveal` selects it in its folder.
#[tauri::command]
pub async fn open_recent_download(
    path: String,
    reveal: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let (sync_dir, known) = {
        let store = state.store.lock().unwrap();
        let known = store.load_recent_downloads().iter().any(|r| r.path == path);
        (std::path::PathBuf::from(store.get_config().sync_dir), known)
    };
    // Only paths a sync recorded: the webview must not be able to launch any file it names.
    if !known {
        return Err("File non presente tra i download recenti".to_string());
    }
    let full = sync_dir.join(&path);
    if !crate::paths::SyncRoot::new(&sync_dir).contains(&full) {
        return Err("Path traversal non consentito".to_string());
    }

    if reveal {
        app.opener().reveal_item_in_dir(&full)
    } else {
        app.opener().open_path(full.to_string_lossy(), None::<String>)
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_window_size(app: AppHandle) -> Result<(), String> {
    crate::window::reset_size(&app)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses_keep_their_json_shape() {
        let user = crate::model::UserInfo {
            id: "1".into(),
            user_name: "u".into(),
            name: crate::model::UserName { given: "A".into(), family: "B".into() },
        };
        let json = |r: LoginResponse| serde_json::to_string(&r).unwrap();
        assert_eq!(
            json(Ok(user).into()),
            r#"{"success":true,"user":{"id":"1","userName":"u","name":{"given":"A","family":"B"}}}"#
        );
        assert_eq!(json(Err("no".to_string()).into()), r#"{"success":false,"error":"no"}"#);
        assert_eq!(serde_json::to_string(&SimpleResponse::OK).unwrap(), r#"{"success":true}"#);
    }

    #[test]
    fn course_list_keeps_one_university_when_the_other_fails() {
        let course = |id: &str| crate::model::Course {
            id: id.into(), course_id: id.into(), name: id.into(), term: None, instructor: None,
        };
        let bocconi = || Some((BlackboardAPI::new(&[]), vec![course("_1_1")]));
        let polimi = || Some((webeep::WeBeepAPI::new("t"), vec![course("webeep:2")]));
        let sources = |blackboard, webeep, errors: &[&str]| Sources {
            blackboard,
            webeep,
            errors: errors.iter().map(|e| e.to_string()).collect(),
        };
        let fields = |r: CoursesResponse| {
            let ids = r.courses.map(|c| c.into_iter().map(|c| c.id).collect::<Vec<String>>());
            (r.success, ids, r.error)
        };
        let ids = |list: &[&str]| Some(list.iter().map(|s| s.to_string()).collect::<Vec<String>>());

        assert_eq!(fields(courses_response(false, &sources(None, None, &[]))), (false, None, Some("Non autenticato".into())));
        assert_eq!(fields(courses_response(true, &sources(bocconi(), polimi(), &[]))), (true, ids(&["_1_1", "webeep:2"]), None));
        assert_eq!(fields(courses_response(false, &sources(None, polimi(), &[]))), (true, ids(&["webeep:2"]), None));
        assert_eq!(
            fields(courses_response(true, &sources(bocconi(), None, &["PoliMi: giù"]))),
            (true, ids(&["_1_1"]), Some("PoliMi: giù".into()))
        );
        assert_eq!(
            fields(courses_response(false, &sources(None, None, &["PoliMi: giù"]))),
            (false, ids(&[]), Some("PoliMi: giù".into()))
        );
        assert_eq!(
            fields(courses_response(true, &sources(None, None, &["Bocconi: a", "PoliMi: b"]))),
            (false, ids(&[]), Some("Bocconi: a · PoliMi: b".into()))
        );
    }
}
