use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use zeroize::Zeroizing;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub sync_dir: String,
    pub auto_sync: bool,
    pub auto_sync_interval: i64,
    pub auto_sync_scheduled_time: String,
    pub sync_all_courses: bool,
    pub enabled_courses: Vec<String>,
    pub course_aliases: HashMap<String, String>,
    pub collapsed_terms: Vec<String>,
    pub hidden_courses: Vec<String>,
    pub hidden_terms: Vec<String>,
    pub last_sync: Option<String>,
    pub minimize_to_tray: bool,
    pub start_at_login: bool,
    pub notifications: bool,
    pub sync_on_startup: bool,
    pub heatmap: bool,
    pub language: String,
    pub theme: String,
    pub tutorial_done: bool,
    // Paused from Settings: the token stays, but courses and syncs skip PoliMi.
    pub webeep_enabled: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        let documents = dirs_next::document_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("BlackBoard Sync")
            .to_string_lossy()
            .into_owned();

        Self {
            sync_dir: documents,
            auto_sync: false,
            auto_sync_interval: 30,
            auto_sync_scheduled_time: "00:00".to_string(),
            sync_all_courses: true,
            enabled_courses: vec![],
            course_aliases: HashMap::new(),
            collapsed_terms: vec![],
            hidden_courses: vec![],
            hidden_terms: vec![],
            last_sync: None,
            minimize_to_tray: true,
            start_at_login: false,
            notifications: true,
            sync_on_startup: false,
            heatmap: false,
            language: String::new(),
            theme: "dark".to_string(),
            tutorial_done: false,
            webeep_enabled: true,
        }
    }
}

/// Server stamp of a synced file and the highest version kept on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStamp {
    pub stamp: String,
    pub version: u32,
}

/// A file saved by a sync; `path` is relative to the sync folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentDownload {
    pub name: String,
    pub path: String,
    pub course: String,
    pub at: String,
}

pub const RECENT_DOWNLOADS_MAX: usize = 100;

/// Temp file + rename: a crash mid-write must not leave a truncated file.
fn write_atomic(path: &std::path::Path, bytes: &[u8]) {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    let written = std::fs::File::create(&tmp).and_then(|mut f| {
        f.write_all(bytes)?;
        f.sync_all()
    });
    if written.is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

pub struct AppStore {
    config_path: PathBuf,
    config: AppConfig,
    data_dir: PathBuf,
}

impl AppStore {
    pub fn new() -> Self {
        let data_dir = dirs_next::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("blackboard-sync");
        let config_path = data_dir.join("config.json");

        let config = Self::load_config_from(&config_path);
        Self { config_path, config, data_dir }
    }

    fn load_config_from(path: &PathBuf) -> AppConfig {
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&data) {
                let default_val = serde_json::to_value(AppConfig::default()).unwrap_or_default();
                if let (Some(default_obj), Some(parsed_obj)) =
                    (default_val.as_object(), parsed.as_object())
                {
                    let mut merged = default_obj.clone();
                    for (k, v) in parsed_obj {
                        merged.insert(k.clone(), v.clone());
                    }
                    let had_sync_all = parsed_obj.contains_key("syncAllCourses");
                    if let Ok(mut config) =
                        serde_json::from_value::<AppConfig>(serde_json::Value::Object(merged))
                    {
                        // Configs older than sync_all_courses: an empty enabled list meant "sync everything".
                        if !had_sync_all {
                            config.sync_all_courses = config.enabled_courses.is_empty();
                        }
                        return config;
                    }
                }
            }
        }
        AppConfig::default()
    }

    pub fn get_config(&self) -> AppConfig {
        self.config.clone()
    }

    pub fn update_config(&mut self, partial: serde_json::Value) -> AppConfig {
        if let Ok(mut current) = serde_json::to_value(&self.config) {
            if let (Some(obj), Some(partial_obj)) =
                (current.as_object_mut(), partial.as_object())
            {
                for (k, v) in partial_obj {
                    obj.insert(k.clone(), v.clone());
                }
            }
            if let Ok(config) = serde_json::from_value::<AppConfig>(current) {
                self.config = config;
                self.save_config();
            }
        }
        self.config.clone()
    }

    fn save_config(&self) {
        if let Some(dir) = self.config_path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.config) {
            write_atomic(&self.config_path, json.as_bytes());
        }
    }

    pub fn load_file_stamps(&self) -> HashMap<String, FileStamp> {
        std::fs::read_to_string(self.data_dir.join("file_stamps.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save_file_stamps(&self, stamps: &HashMap<String, FileStamp>) {
        let _ = std::fs::create_dir_all(&self.data_dir);
        if let Ok(json) = serde_json::to_string(stamps) {
            write_atomic(&self.data_dir.join("file_stamps.json"), json.as_bytes());
        }
    }

    /// Newest first.
    pub fn load_recent_downloads(&self) -> Vec<RecentDownload> {
        std::fs::read_to_string(self.data_dir.join("recent_downloads.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn add_recent_downloads(&self, new: Vec<RecentDownload>) {
        if new.is_empty() {
            return;
        }
        let mut list = new;
        list.extend(self.load_recent_downloads());
        // A file downloaded again (deleted by the user, say) keeps only its newest entry.
        let mut seen = std::collections::HashSet::new();
        list.retain(|r| seen.insert(r.path.clone()));
        list.truncate(RECENT_DOWNLOADS_MAX);
        let _ = std::fs::create_dir_all(&self.data_dir);
        if let Ok(json) = serde_json::to_string(&list) {
            write_atomic(&self.data_dir.join("recent_downloads.json"), json.as_bytes());
        }
    }

    pub fn save_credentials(&self, username: &str, password: &str) {
        let payload = serde_json::json!({ "username": username, "password": password });
        if let Ok(entry) = keyring::Entry::new("blackboard-sync", "credentials") {
            let _ = entry.set_password(&payload.to_string());
        }
    }

    pub fn load_credentials(&self) -> Option<(String, Zeroizing<String>)> {
        let entry = keyring::Entry::new("blackboard-sync", "credentials").ok()?;
        let json = entry.get_password().ok()?;
        let val: serde_json::Value = serde_json::from_str(&json).ok()?;
        let username = val["username"].as_str()?.to_string();
        let password = Zeroizing::new(val["password"].as_str()?.to_string());
        Some((username, password))
    }

    pub fn clear_credentials(&self) {
        if let Ok(entry) = keyring::Entry::new("blackboard-sync", "credentials") {
            let _ = entry.delete_credential();
        }
    }

    pub fn save_session(&self, cookies: &[String]) {
        if let Ok(json) = serde_json::to_string(cookies) {
            if let Ok(entry) = keyring::Entry::new("blackboard-sync", "session") {
                let _ = entry.set_password(&json);
            }
        }
    }

    pub fn load_session(&self) -> Option<Vec<String>> {
        let entry = keyring::Entry::new("blackboard-sync", "session").ok()?;
        let json = entry.get_password().ok()?;
        serde_json::from_str::<Vec<String>>(&json).ok()
    }

    pub fn clear_session(&self) {
        if let Ok(entry) = keyring::Entry::new("blackboard-sync", "session") {
            let _ = entry.delete_credential();
        }
    }

    // Own keyring entry, so each university connects and disconnects independently.
    pub fn save_webeep_token(&self, token: &str) {
        if let Ok(entry) = keyring::Entry::new("blackboard-sync", "webeep") {
            let _ = entry.set_password(token);
        }
    }

    pub fn load_webeep_token(&self) -> Option<String> {
        let entry = keyring::Entry::new("blackboard-sync", "webeep").ok()?;
        entry.get_password().ok()
    }

    pub fn clear_webeep_token(&self) {
        if let Ok(entry) = keyring::Entry::new("blackboard-sync", "webeep") {
            let _ = entry.delete_credential();
        }
    }

    pub fn save_instructors_cache(&self, map: &HashMap<String, String>) {
        let path = self.data_dir.join("instructors_cache.json");
        let _ = std::fs::create_dir_all(&self.data_dir);
        if let Ok(json) = serde_json::to_string(map) {
            let _ = std::fs::write(path, json);
        }
    }

    pub fn load_instructors_cache(&self) -> HashMap<String, String> {
        let path = self.data_dir.join("instructors_cache.json");
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, at: &str) -> RecentDownload {
        RecentDownload { name: path.into(), path: path.into(), course: "C".into(), at: at.into() }
    }

    #[test]
    fn recent_downloads_keep_newest_entry_per_path_and_cap_the_list() {
        let data_dir = std::env::temp_dir().join(format!("bbsync-recent-{}", std::process::id()));
        let store = AppStore { config_path: data_dir.join("config.json"), config: AppConfig::default(), data_dir: data_dir.clone() };

        store.add_recent_downloads(vec![entry("a.pdf", "1"), entry("b.pdf", "1")]);
        store.add_recent_downloads(vec![entry("a.pdf", "2")]);
        let list = store.load_recent_downloads();
        assert_eq!(list.iter().map(|r| (r.path.as_str(), r.at.as_str())).collect::<Vec<_>>(), [("a.pdf", "2"), ("b.pdf", "1")]);

        store.add_recent_downloads((0..RECENT_DOWNLOADS_MAX + 5).map(|i| entry(&format!("{i}.pdf"), "3")).collect());
        assert_eq!(store.load_recent_downloads().len(), RECENT_DOWNLOADS_MAX);

        let _ = std::fs::remove_dir_all(data_dir);
    }
}
