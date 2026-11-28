use serde::{de::DeserializeOwned, Deserialize, Serialize};
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

/// A keyring entry of the `blackboard-sync` service. Renaming one signs every user out.
struct Secret(&'static str);

const KEYRING_SERVICE: &str = "blackboard-sync";
const CREDENTIALS: Secret = Secret("credentials");
const SESSION: Secret = Secret("session");
// Own entry, so each university connects and disconnects independently.
const WEBEEP_TOKEN: Secret = Secret("webeep");

impl Secret {
    fn entry(&self) -> Option<keyring::Entry> {
        keyring::Entry::new(KEYRING_SERVICE, self.0).ok()
    }
    fn get(&self) -> Option<String> {
        self.entry()?.get_password().ok()
    }
    fn set(&self, value: &str) {
        if let Some(entry) = self.entry() {
            let _ = entry.set_password(value);
        }
    }
    fn clear(&self) {
        if let Some(entry) = self.entry() {
            let _ = entry.delete_credential();
        }
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

    /// Missing or unreadable reads as empty.
    fn read_json<T: DeserializeOwned + Default>(&self, name: &str) -> T {
        std::fs::read_to_string(self.data_dir.join(name))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn write_json<T: Serialize>(&self, name: &str, value: &T) {
        let _ = std::fs::create_dir_all(&self.data_dir);
        if let Ok(json) = serde_json::to_string(value) {
            write_atomic(&self.data_dir.join(name), json.as_bytes());
        }
    }

    pub fn load_file_stamps(&self) -> HashMap<String, FileStamp> {
        self.read_json("file_stamps.json")
    }

    pub fn save_file_stamps(&self, stamps: &HashMap<String, FileStamp>) {
        self.write_json("file_stamps.json", stamps);
    }

    /// Newest first.
    pub fn load_recent_downloads(&self) -> Vec<RecentDownload> {
        self.read_json("recent_downloads.json")
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
        self.write_json("recent_downloads.json", &list);
    }

    pub fn load_instructors_cache(&self) -> HashMap<String, String> {
        self.read_json("instructors_cache.json")
    }

    pub fn save_instructors_cache(&self, map: &HashMap<String, String>) {
        self.write_json("instructors_cache.json", map);
    }

    pub fn save_credentials(&self, username: &str, password: &str) {
        let payload = serde_json::json!({ "username": username, "password": password });
        CREDENTIALS.set(&payload.to_string());
    }

    pub fn load_credentials(&self) -> Option<(String, Zeroizing<String>)> {
        let json = Zeroizing::new(CREDENTIALS.get()?);
        let val: serde_json::Value = serde_json::from_str(&json).ok()?;
        let username = val["username"].as_str()?.to_string();
        let password = Zeroizing::new(val["password"].as_str()?.to_string());
        Some((username, password))
    }

    pub fn clear_credentials(&self) {
        CREDENTIALS.clear();
    }

    pub fn save_session(&self, cookies: &[String]) {
        if let Ok(json) = serde_json::to_string(cookies) {
            SESSION.set(&json);
        }
    }

    pub fn load_session(&self) -> Option<Vec<String>> {
        serde_json::from_str(&SESSION.get()?).ok()
    }

    pub fn clear_session(&self) {
        SESSION.clear();
    }

    pub fn save_webeep_token(&self, token: &str) {
        WEBEEP_TOKEN.set(token);
    }

    pub fn load_webeep_token(&self) -> Option<String> {
        WEBEEP_TOKEN.get()
    }

    pub fn clear_webeep_token(&self) {
        WEBEEP_TOKEN.clear();
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


    fn temp_store(name: &str) -> (AppStore, PathBuf) {
        let data_dir = std::env::temp_dir().join(format!("bbsync-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&data_dir);
        std::fs::create_dir_all(&data_dir).unwrap();
        let config_path = data_dir.join("config.json");
        (AppStore { config_path, config: AppConfig::default(), data_dir: data_dir.clone() }, data_dir)
    }

    #[test]
    fn keyring_entries_keep_their_names() {
        assert_eq!(
            (KEYRING_SERVICE, CREDENTIALS.0, SESSION.0, WEBEEP_TOKEN.0),
            ("blackboard-sync", "credentials", "session", "webeep")
        );
    }

    #[test]
    fn stamps_and_instructors_keep_their_files_and_format() {
        let (store, dir) = temp_store("files");
        store.save_file_stamps(&HashMap::from([("C/a.pdf".to_string(), FileStamp { stamp: "s".into(), version: 2 })]));
        store.save_instructors_cache(&HashMap::from([("_1_1".to_string(), "Ada Lovelace".to_string())]));
        assert_eq!(std::fs::read_to_string(dir.join("file_stamps.json")).unwrap(), r#"{"C/a.pdf":{"stamp":"s","version":2}}"#);
        assert_eq!(std::fs::read_to_string(dir.join("instructors_cache.json")).unwrap(), r#"{"_1_1":"Ada Lovelace"}"#);
        assert_eq!(store.load_file_stamps()["C/a.pdf"].version, 2);
        assert_eq!(store.load_instructors_cache()["_1_1"], "Ada Lovelace");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn saved_config_fills_missing_fields_with_defaults() {
        let (store, dir) = temp_store("partial");
        std::fs::write(&store.config_path, r#"{"syncDir":"D:/Uni","theme":"light","syncAllCourses":false}"#).unwrap();
        let config = AppStore::load_config_from(&store.config_path);
        let default = AppConfig::default();
        assert_eq!(config.sync_dir, "D:/Uni");
        assert_eq!(config.theme, "light");
        assert!(!config.sync_all_courses);
        assert_eq!(config.auto_sync_interval, default.auto_sync_interval);
        assert_eq!(config.minimize_to_tray, default.minimize_to_tray);
        assert_eq!(config.language, default.language);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn configs_older_than_sync_all_courses_keep_their_meaning() {
        let (store, dir) = temp_store("legacy");
        std::fs::write(&store.config_path, r#"{"enabledCourses":[]}"#).unwrap();
        assert!(AppStore::load_config_from(&store.config_path).sync_all_courses);
        std::fs::write(&store.config_path, r#"{"enabledCourses":["_123_1"]}"#).unwrap();
        let config = AppStore::load_config_from(&store.config_path);
        assert!(!config.sync_all_courses);
        assert_eq!(config.enabled_courses, ["_123_1"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unreadable_or_mistyped_config_falls_back_to_defaults() {
        let (store, dir) = temp_store("broken");
        let default = AppConfig::default();
        std::fs::write(&store.config_path, "non è json").unwrap();
        assert_eq!(AppStore::load_config_from(&store.config_path).sync_dir, default.sync_dir);
        std::fs::write(&store.config_path, r#"{"autoSync":"sì","syncDir":"D:/Uni"}"#).unwrap();
        assert_eq!(AppStore::load_config_from(&store.config_path).sync_dir, default.sync_dir);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn update_config_merges_saves_and_rejects_wrong_types() {
        let (mut store, dir) = temp_store("update");
        let updated = store.update_config(serde_json::json!({ "autoSync": true, "autoSyncInterval": 60 }));
        assert!(updated.auto_sync);
        assert_eq!(updated.auto_sync_interval, 60);
        let saved = AppStore::load_config_from(&store.config_path);
        assert!(saved.auto_sync);
        assert_eq!(saved.auto_sync_interval, 60);

        let unchanged = store.update_config(serde_json::json!({ "autoSyncInterval": "spesso", "theme": "light" }));
        assert_eq!(unchanged.auto_sync_interval, 60);
        assert_eq!(unchanged.theme, "dark");

        let ignored = store.update_config(serde_json::json!({ "campoSconosciuto": 1 }));
        assert_eq!(ignored.auto_sync_interval, 60);
        let _ = std::fs::remove_dir_all(dir);
    }
}
