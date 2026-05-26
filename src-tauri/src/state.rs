use crate::store::AppStore;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::async_runtime::JoinHandle;

#[derive(Clone)]
pub struct Session {
    pub cookies: Vec<String>,
}

pub struct AppState {
    pub store: Mutex<AppStore>,
    pub session: Mutex<Option<Session>>,
    pub syncing: AtomicBool,
    pub abort_flag: std::sync::Arc<AtomicBool>,
    pub autosync_handle: Mutex<Option<JoinHandle<()>>>,
    pub has_completed_first_launch: AtomicBool,
    pub is_quitting: AtomicBool,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            store: Mutex::new(AppStore::new()),
            session: Mutex::new(None),
            syncing: AtomicBool::new(false),
            abort_flag: std::sync::Arc::new(AtomicBool::new(false)),
            autosync_handle: Mutex::new(None),
            has_completed_first_launch: AtomicBool::new(false),
            is_quitting: AtomicBool::new(false),
        }
    }
}
