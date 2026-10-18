//! WeBeep (PoliMi) Moodle client. The token comes from Moodle's mobile launch flow
//! in an SSO webview, so the Polimi password never passes through this process.

use crate::download::FileToDownload;
use crate::state::AppState;
use base64::Engine;
use reqwest::Client;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const SITE: &str = "https://webeep.polimi.it";
const HOST: &str = "webeep.polimi.it";
const SERVICE: &str = "moodle_mobile_app";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BlackBoardSync/1.0";

/// Keeps Moodle's small integer ids apart from Blackboard ids in the shared config lists.
pub const ID_PREFIX: &str = "webeep:";

/// SSO window label prefix, so a stale window can be found and closed.
const WINDOW_PREFIX: &str = "webeep-login-";

#[derive(Deserialize)]
pub struct SiteInfo {
    pub userid: i64,
    pub username: String,
    pub firstname: String,
    pub lastname: String,
}

#[derive(Deserialize)]
struct MoodleCourse {
    id: i64,
    fullname: String,
    shortname: String,
    startdate: Option<i64>,
}

#[derive(Deserialize)]
struct Section {
    #[serde(default)]
    name: String,
    #[serde(default)]
    modules: Vec<Module>,
}

#[derive(Deserialize)]
struct Module {
    #[serde(default)]
    name: String,
    #[serde(default)]
    modname: String,
    #[serde(default)]
    contents: Option<Vec<Content>>,
}

#[derive(Deserialize)]
struct Content {
    #[serde(rename = "type", default)]
    kind: String,
    filename: Option<String>,
    fileurl: Option<String>,
    filepath: Option<String>,
    timemodified: Option<i64>,
}

/// Moodle answers errors with HTTP 200 and this shape.
#[derive(Deserialize)]
struct MoodleError {
    errorcode: String,
    message: String,
}

#[derive(Clone)]
pub struct WeBeepAPI {
    client: Client,
    token: String,
}

impl WeBeepAPI {
    pub fn new(token: &str) -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            // Download URLs carry the token: keep it out of Referer on redirects.
            .referer(false)
            .timeout(std::time::Duration::from_secs(30))
            .read_timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to build webeep client");
        Self { client, token: token.to_string() }
    }

    async fn call<T: serde::de::DeserializeOwned>(
        &self,
        function: &str,
        params: &[(&str, String)],
    ) -> Result<T, String> {
        let mut query: Vec<(&str, String)> = vec![
            ("wstoken", self.token.clone()),
            ("wsfunction", function.to_string()),
            ("moodlewsrestformat", "json".to_string()),
        ];
        query.extend(params.iter().cloned());

        let body = self
            .client
            .get(format!("{}/webservice/rest/server.php", SITE))
            .query(&query)
            .send()
            .await
            // The error text would end with the URL, wstoken included: it reaches the UI and toasts.
            .map_err(|e| e.without_url().to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?;

        if let Ok(err) = serde_json::from_str::<MoodleError>(&body) {
            eprintln!("[webeep] {} respinta: {} ({})", function, err.message, err.errorcode);
            if err.errorcode == "invalidtoken" || err.errorcode == "accessexception" {
                return Err("Sessione WeBeep scaduta. Rieffettua l'accesso.".to_string());
            }
            return Err(err.message);
        }

        // Log the serde error (field and offset), never the body: it is the user's course data.
        serde_json::from_str::<T>(&body).map_err(|e| {
            eprintln!("[webeep] {} illeggibile: {} ({} byte)", function, e, body.len());
            e.to_string()
        })
    }

    pub async fn site_info(&self) -> Result<SiteInfo, String> {
        self.call("core_webservice_get_site_info", &[]).await
    }

    async fn courses(&self, userid: i64) -> Result<Vec<MoodleCourse>, String> {
        self.call("core_enrol_get_users_courses", &[("userid", userid.to_string())])
            .await
    }

    async fn contents(&self, courseid: i64) -> Result<Vec<Section>, String> {
        self.call("core_course_get_contents", &[("courseid", courseid.to_string())])
            .await
    }

    /// Appends the token as a query pair (the URLs already carry `?forcedownload=1`).
    /// The host check stops a tampered response from sending the token elsewhere.
    pub fn signed_url(&self, fileurl: &str) -> Result<String, String> {
        let mut url = url::Url::parse(fileurl).map_err(|e| e.to_string())?;
        if url.scheme() != "https" || url.host_str() != Some(HOST) {
            return Err(format!("URL non attendibile: {}", fileurl));
        }
        url.query_pairs_mut().append_pair("token", &self.token);
        Ok(url.to_string())
    }

    pub async fn download(&self, fileurl: &str) -> Result<reqwest::Response, String> {
        let signed = self.signed_url(fileurl)?;
        let resp = self
            .client
            .get(signed)
            .timeout(crate::download::DOWNLOAD_TIMEOUT)
            .send()
            .await
            .map_err(|e| e.without_url().to_string())?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        Ok(resp)
    }
}

pub fn is_webeep(course_id: &str) -> bool {
    course_id.starts_with(ID_PREFIX)
}

fn numeric_id(course_id: &str) -> Option<i64> {
    course_id.strip_prefix(ID_PREFIX)?.parse().ok()
}

/// The label names the university: a bare "2026/27" reads as a Bocconi term in the shared list.
fn academic_term(start_year: i32) -> crate::blackboard::Term {
    crate::blackboard::Term {
        id: format!("{}term:{}", ID_PREFIX, start_year),
        name: format!("{}/{:02} (PoliMi)", start_year, (start_year + 1) % 100),
    }
}

/// Term from the "[2026-27]" suffix of the course name. `startdate` is often a year
/// early (it is when the Moodle space was created), so it is only the fallback.
fn term_from_name(fullname: &str) -> Option<crate::blackboard::Term> {
    let open = fullname.rfind('[')?;
    let close = fullname[open..].find(']')? + open;
    let (first, second) = fullname[open + 1..close].trim().split_once('-')?;
    let (first, second) = (first.trim(), second.trim());

    if first.len() != 4 || !first.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if second.len() != 2 || !second.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(academic_term(first.parse().ok()?))
}

/// Fallback when the name has no year: the start date, with a September rollover.
fn term_from_startdate(startdate: Option<i64>) -> Option<crate::blackboard::Term> {
    use chrono::Datelike;
    let ts = startdate.filter(|t| *t > 0)?;
    let date = chrono::DateTime::from_timestamp(ts, 0)?;
    let (year, month) = (date.year(), date.month());
    Some(academic_term(if month >= 9 { year } else { year - 1 }))
}

pub fn user_info(info: &SiteInfo) -> crate::blackboard::UserInfo {
    crate::blackboard::UserInfo {
        id: format!("{}{}", ID_PREFIX, info.userid),
        user_name: info.username.clone(),
        name: crate::blackboard::UserName {
            given: info.firstname.clone(),
            family: info.lastname.clone(),
        },
    }
}

/// "BINOSI" -> "Binosi", "D'AMICO" -> "D'Amico".
fn title_case(word: &str) -> String {
    let mut out = String::with_capacity(word.len());
    let mut at_start = true;
    for c in word.chars() {
        if c.is_alphabetic() {
            if at_start {
                out.extend(c.to_uppercase());
            } else {
                out.extend(c.to_lowercase());
            }
            at_start = false;
        } else {
            out.push(c);
            at_start = true;
        }
    }
    out
}

/// "DE MARIA ALESSANDRO" -> "Alessandro De Maria", Blackboard's order. Two given names come
/// out scrambled: WeBeep has no structured teacher fields, and the UI alias is the fix.
fn format_teacher(raw: &str) -> Option<String> {
    let words: Vec<&str> = raw.split_whitespace().collect();
    match words.split_last()? {
        (given, []) => Some(title_case(given)),
        (given, family) => Some(format!(
            "{} {}",
            title_case(given),
            family.iter().map(|w| title_case(w)).collect::<Vec<_>>().join(" ")
        )),
    }
}

/// "056896 - NAME (BINOSI LORENZO) [2026-27]" -> ("NAME", Some("Lorenzo Binosi")).
/// The short name also keeps nested sync paths under the Windows 260-character limit.
fn split_course_title(fullname: &str) -> (String, Option<String>) {
    let mut rest = fullname.trim();

    if rest.ends_with(']') {
        if let Some(open) = rest.rfind('[') {
            rest = rest[..open].trim_end();
        }
    }

    let mut teacher = None;
    if rest.ends_with(')') {
        if let Some(open) = rest.rfind('(') {
            let names: Vec<String> = rest[open + 1..rest.len() - 1]
                .split(',')
                .filter_map(|n| format_teacher(n.trim()))
                .filter(|n| !n.is_empty())
                .collect();
            if !names.is_empty() {
                teacher = Some(names.join(", "));
                rest = rest[..open].trim_end();
            }
        }
    }

    if let Some((code, name)) = rest.split_once(" - ") {
        if !code.is_empty() && code.chars().all(|c| c.is_ascii_digit()) {
            rest = name.trim();
        }
    }

    let name = if rest.is_empty() { fullname.trim() } else { rest };
    (name.to_string(), teacher)
}

pub async fn get_courses(
    api: &WeBeepAPI,
    userid: i64,
) -> Result<Vec<crate::blackboard::Course>, String> {
    let courses = api.courses(userid).await?;
    Ok(courses
        .into_iter()
        .map(|c| {
            let (name, instructor) = split_course_title(&c.fullname);
            crate::blackboard::Course {
                id: format!("{}{}", ID_PREFIX, c.id),
                course_id: c.shortname,
                term: term_from_name(&c.fullname).or_else(|| term_from_startdate(c.startdate)),
                name,
                instructor,
            }
        })
        .collect())
}

pub async fn scan_course(
    api: &WeBeepAPI,
    course: &crate::blackboard::Course,
    base_path: &str,
) -> Result<Vec<FileToDownload>, String> {
    let Some(id) = numeric_id(&course.id) else {
        return Ok(Vec::new());
    };
    Ok(files_from_sections(api.contents(id).await?, course, base_path))
}

/// Files go flat in the course folder: Moodle section and module names are dropped, real
/// `filepath` subfolders kept. A name clash puts the file back under its module and section.
fn files_from_sections(
    sections: Vec<Section>,
    course: &crate::blackboard::Course,
    base_path: &str,
) -> Vec<FileToDownload> {
    struct Candidate {
        section: String,
        module: String,
        sub: PathBuf,
        name: String,
        url: String,
        stamp: Option<String>,
    }

    let mut candidates: Vec<Candidate> = Vec::new();
    for section in sections {
        for module in section.modules {
            if module.modname == "url" {
                continue;
            }
            let Some(contents) = module.contents else {
                continue;
            };

            for item in contents {
                if item.kind != "file" {
                    continue;
                }
                let (Some(name), Some(fileurl)) = (item.filename, item.fileurl) else {
                    continue;
                };

                let mut sub = PathBuf::new();
                for part in item.filepath.as_deref().unwrap_or("/").split('/') {
                    if !part.is_empty() {
                        sub = sub.join(crate::download::sanitize_path(part));
                    }
                }

                candidates.push(Candidate {
                    section: section.name.trim().to_string(),
                    module: module.name.trim().to_string(),
                    sub,
                    name,
                    url: fileurl,
                    stamp: item.timemodified.map(|t| t.to_string()),
                });
            }
        }
    }

    // Only distinct files (by URL) contest a path; the same file listed twice stays flat.
    let mut claims: HashMap<PathBuf, HashSet<String>> = HashMap::new();
    for c in &candidates {
        claims
            .entry(c.sub.join(crate::download::sanitize_path(&c.name)))
            .or_default()
            .insert(c.url.clone());
    }

    let base = PathBuf::from(base_path);
    candidates
        .into_iter()
        .map(|c| {
            let flat = c.sub.join(crate::download::sanitize_path(&c.name));
            let contested = claims.get(&flat).map(|u| u.len() > 1).unwrap_or(false);

            let mut dir = base.clone();
            if contested {
                for label in [&c.module, &c.section] {
                    if !label.is_empty() {
                        dir = dir.join(crate::download::sanitize_path(label));
                    }
                }
            }

            let rel = dir.join(&flat);
            FileToDownload {
                course_id: course.id.clone(),
                course_name: course.name.clone(),
                content_id: String::new(),
                attachment_id: String::new(),
                file_name: c.name,
                relative_path: rel.to_string_lossy().into_owned(),
                url: Some(c.url),
                webeep: true,
                stamp: c.stamp,
            }
        })
        .collect()
}

fn random_passport() -> String {
    let mut bytes = [0u8; 16];
    // No fallback to a guessable nonce: an empty string makes the caller abort.
    if getrandom::getrandom(&mut bytes).is_err() {
        return String::new();
    }
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// `md5(wwwroot + passport)`, no trailing slash; verified against live webeep.polimi.it payloads.
fn launch_signature(passport: &str) -> String {
    format!("{:x}", md5::compute(format!("{}{}", SITE, passport)))
}

/// Decodes base64 `md5(wwwroot+passport):::token[:::privatetoken]`. The signature inputs are
/// public: the unguessable passport binds the token to our window, `site_info` proves it.
fn decode_launch_token(raw: &str, passport: &str) -> Result<String, String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|_| "Risposta di WeBeep illeggibile".to_string())?;
    let text =
        String::from_utf8(decoded).map_err(|_| "Risposta di WeBeep illeggibile".to_string())?;

    let mut parts = text.split(":::");
    let signature = parts.next().unwrap_or_default();
    let token = parts.next().unwrap_or_default().trim().to_string();

    if signature != launch_signature(passport) {
        return Err("Risposta di WeBeep non riconosciuta".to_string());
    }
    if token.len() != 32 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Token WeBeep non valido".to_string());
    }
    Ok(token)
}

/// Opens the Polimi SSO window and resolves on the `moodlemobile://token=…` redirect.
pub async fn acquire_token(app: &AppHandle) -> Result<String, String> {
    // Must be unguessable, not just unique: with a predictable passport any page in
    // this webview could mint a validly signed payload carrying its own token.
    let passport = random_passport();
    if passport.is_empty() {
        return Err("Impossibile generare un nonce sicuro per l'accesso".to_string());
    }
    // Tauri exposes the label to page script, so it gets its own random id, never the passport.
    let label = format!("{}{}", WINDOW_PREFIX, random_passport());

    // Close windows of abandoned attempts rather than refusing this one until they time out.
    for (existing_label, window) in app.webview_windows() {
        if existing_label.starts_with(WINDOW_PREFIX) {
            let _ = window.close();
        }
    }

    let launch = format!(
        "{}/admin/tool/mobile/launch.php?service={}&passport={}&urlscheme=moodlemobile",
        SITE, SERVICE, passport
    );

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    let nav_tx = Arc::clone(&tx);
    let nav_passport = passport.clone();
    // The SSO chain crosses hosts we cannot list, but only WeBeep's launch.php emits
    // moodlemobile://, so a token is accepted only when the previous hop was on HOST.
    let last_host: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let nav_host = Arc::clone(&last_host);
    let window = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::External(
            launch.parse().map_err(|_| "URL di login non valido".to_string())?,
        ),
    )
    .title("Accedi a WeBeep — Politecnico di Milano")
    .inner_size(560.0, 720.0)
    .center()
    .focused(true)
    .on_navigation(move |url| {
        if url.scheme() != "moodlemobile" {
            // No query or fragment: they carry SAML tickets, OAuth codes and the token.
            eprintln!("[webeep] nav: {}://{}{}", url.scheme(), url.host_str().unwrap_or("-"), url.path());
            *nav_host.lock().unwrap() = url.host_str().map(|h| h.to_string());
            return true;
        }

        if nav_host.lock().unwrap().as_deref() != Some(HOST) {
            eprintln!("[webeep] token offerto da un'origine inattesa, ignorato");
            return false;
        }
        // `moodlemobile://token=<base64>` has no valid authority: read the raw string.
        let raw = url.as_str().to_string();
        let payload = raw.split("token=").nth(1).unwrap_or_default().trim_end_matches('/');
        if let Some(tx) = nav_tx.lock().unwrap().take() {
            let _ = tx.send(decode_launch_token(payload, &nav_passport));
        }
        false // never actually navigate to the custom scheme
    })
    .build()
    .map_err(|e| e.to_string())?;

    let close_tx = Arc::clone(&tx);
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(tx) = close_tx.lock().unwrap().take() {
                let _ = tx.send(Err("Accesso a WeBeep annullato".to_string()));
            }
        }
    });

    let outcome = tokio::time::timeout(std::time::Duration::from_secs(600), rx)
        .await
        .map_err(|_| "Tempo scaduto per l'accesso a WeBeep".to_string())?
        .map_err(|_| "Accesso a WeBeep interrotto".to_string())?;

    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    outcome
}

/// `Ok(None)`: not connected or paused. `Err`: the stored token is rejected, shown as a
/// warning so the Blackboard side still syncs.
pub async fn active_api(app: &AppHandle) -> Result<Option<(WeBeepAPI, SiteInfo)>, String> {
    if !app.state::<AppState>().store.lock().unwrap().get_config().webeep_enabled {
        return Ok(None);
    }
    connected_api(app).await
}

/// The connected account even when paused, for showing who is signed in.
pub async fn connected_api(app: &AppHandle) -> Result<Option<(WeBeepAPI, SiteInfo)>, String> {
    let token = app.state::<AppState>().store.lock().unwrap().load_webeep_token();
    let Some(token) = token else {
        return Ok(None);
    };
    let api = WeBeepAPI::new(&token);
    let info = api.site_info().await?;
    Ok(Some((api, info)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Signature from a real webeep.polimi.it launch, pinning the md5(wwwroot + passport) scheme.
    #[test]
    fn signature_matches_live_launch_payload() {
        assert_eq!(
            launch_signature("1789745596854445200"),
            "7972eb2094912a78ee73af757f86a360"
        );
    }

    #[test]
    fn decodes_valid_launch_payload() {
        let token = "0123456789abcdef0123456789abcdef";
        let raw = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:::{}:::priv", launch_signature("pass123"), token));
        assert_eq!(decode_launch_token(&raw, "pass123").unwrap(), token);
    }

    #[test]
    fn rejects_mismatched_passport() {
        let raw = base64::engine::general_purpose::STANDARD.encode(format!(
            "{}:::0123456789abcdef0123456789abcdef",
            launch_signature("otherpass")
        ));
        assert!(decode_launch_token(&raw, "pass123").is_err());
    }

    #[test]
    fn passport_is_unpredictable() {
        let a = random_passport();
        let b = random_passport();
        assert_eq!(a.len(), 32, "128 bit in esadecimale");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn rejects_raw_passport_as_signature() {
        let raw = base64::engine::general_purpose::STANDARD
            .encode("pass123:::0123456789abcdef0123456789abcdef");
        assert!(decode_launch_token(&raw, "pass123").is_err());
    }

    #[test]
    fn rejects_non_hex_token() {
        let raw = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:::not-a-token", launch_signature("pass123")));
        assert!(decode_launch_token(&raw, "pass123").is_err());
    }

    #[test]
    fn signed_url_rejects_foreign_host() {
        let api = WeBeepAPI::new("t");
        assert!(api.signed_url("https://evil.example/file.pdf").is_err());
        assert!(api
            .signed_url("https://webeep.polimi.it/webservice/pluginfile.php/1/f.pdf")
            .is_ok());
    }

    /// Real WeBeep course name; its startdate would have filed it under 2025/26.
    #[test]
    fn term_comes_from_the_bracketed_year_in_the_name() {
        let term =
            term_from_name("054323 - INTERNET OF THINGS (CESANA MATTEO) [2026-27]").unwrap();
        assert_eq!(term.name, "2026/27 (PoliMi)");
        assert_eq!(term.id, "webeep:term:2026");
    }

    /// Pinned to a real WeBeep course title.
    #[test]
    fn splits_a_real_course_title() {
        let (name, teacher) =
            split_course_title("056896 - OFFENSIVE AND DEFENSIVE CYBERSECURITY (BINOSI LORENZO) [2026-27]");
        assert_eq!(name, "OFFENSIVE AND DEFENSIVE CYBERSECURITY");
        assert_eq!(teacher.as_deref(), Some("Lorenzo Binosi"));
    }

    #[test]
    fn splits_multi_word_surnames_and_several_teachers() {
        let (name, teacher) =
            split_course_title("054323 - INTERNET OF THINGS (DE MARIA ALESSANDRO, ROSSI ANNA) [2026-27]");
        assert_eq!(name, "INTERNET OF THINGS");
        assert_eq!(teacher.as_deref(), Some("Alessandro De Maria, Anna Rossi"));
    }

    #[test]
    fn keeps_plain_titles_as_they_are() {
        let (name, teacher) = split_course_title("ETHICS SEMINAR");
        assert_eq!(name, "ETHICS SEMINAR");
        assert_eq!(teacher, None);
    }

    #[test]
    fn keeps_parenthesised_titles_that_are_not_teachers() {
        let (name, teacher) = split_course_title("MATEMATICA (AVANZATA)");
        assert_eq!(name, "MATEMATICA");
        assert_eq!(teacher.as_deref(), Some("Avanzata"));
    }


    fn course(id: &str) -> crate::blackboard::Course {
        crate::blackboard::Course {
            id: format!("{}{}", ID_PREFIX, id),
            course_id: "SC".into(),
            name: "CORSO".into(),
            term: None,
            instructor: None,
        }
    }

    fn paths(json: &str) -> Vec<String> {
        let sections: Vec<Section> = serde_json::from_str(json).expect("fixture");
        let mut out: Vec<String> = files_from_sections(sections, &course("1"), "CORSO")
            .into_iter()
            .map(|f| f.relative_path.replace('\\', "/"))
            .collect();
        out.sort();
        out
    }

    #[test]
    fn files_land_directly_in_the_course_folder() {
        let out = paths(
            r#"[{"name":"Introduzione","modules":[
                 {"name":"Course materials","modname":"folder","contents":[
                   {"type":"file","filename":"slides.pdf","fileurl":"https://webeep.polimi.it/a.pdf","filepath":"/"}]}]}]"#,
        );
        assert_eq!(out, vec!["CORSO/slides.pdf"]);
    }

    #[test]
    fn keeps_subdirectories_from_filepath() {
        let out = paths(
            r#"[{"name":"Lezioni","modules":[
                 {"name":"Materiale","modname":"folder","contents":[
                   {"type":"file","filename":"es1.pdf","fileurl":"https://webeep.polimi.it/b.pdf","filepath":"/esercizi/settimana1/"}]}]}]"#,
        );
        assert_eq!(out, vec!["CORSO/esercizi/settimana1/es1.pdf"]);
    }

    #[test]
    fn disambiguates_colliding_filenames() {
        let out = paths(
            r#"[{"name":"Parte 1","modules":[
                 {"name":"Slide","modname":"folder","contents":[
                   {"type":"file","filename":"intro.pdf","fileurl":"https://webeep.polimi.it/one.pdf","filepath":"/"}]}]},
                {"name":"Parte 2","modules":[
                 {"name":"Dispense","modname":"folder","contents":[
                   {"type":"file","filename":"intro.pdf","fileurl":"https://webeep.polimi.it/two.pdf","filepath":"/"}]}]}]"#,
        );
        assert_eq!(
            out,
            vec!["CORSO/Dispense/Parte 2/intro.pdf", "CORSO/Slide/Parte 1/intro.pdf"]
        );
    }

    /// Not a collision: the caller's dedup drops the repeat.
    #[test]
    fn repeated_identical_file_stays_flat() {
        let out = paths(
            r#"[{"name":"A","modules":[
                 {"name":"M1","modname":"folder","contents":[
                   {"type":"file","filename":"x.pdf","fileurl":"https://webeep.polimi.it/x.pdf","filepath":"/"}]},
                 {"name":"M2","modname":"folder","contents":[
                   {"type":"file","filename":"x.pdf","fileurl":"https://webeep.polimi.it/x.pdf","filepath":"/"}]}]}]"#,
        );
        assert_eq!(out, vec!["CORSO/x.pdf", "CORSO/x.pdf"]);
    }

    #[test]
    fn skips_url_modules() {
        let out = paths(
            r#"[{"name":"A","modules":[
                 {"name":"Sito","modname":"url","contents":[
                   {"type":"url","filename":"link","fileurl":"https://webeep.polimi.it/l","filepath":"/"}]}]}]"#,
        );
        assert!(out.is_empty());
    }

    #[test]
    fn title_case_handles_apostrophes() {
        assert_eq!(title_case("D'AMICO"), "D'Amico");
        assert_eq!(title_case("LO-PRESTI"), "Lo-Presti");
    }

    #[test]
    fn term_from_name_ignores_names_without_a_year() {
        assert!(term_from_name("ETHICS SEMINAR").is_none());
        assert!(term_from_name("CORSO [non-un-anno]").is_none());
        assert!(term_from_name("CORSO [2026-2027]").is_none());
    }

    #[test]
    fn term_rolls_over_in_september() {
        // 2025-10-01 → academic year 2025/26
        assert_eq!(
            term_from_startdate(Some(1759276800)).unwrap().name,
            "2025/26 (PoliMi)"
        );
        // 2025-03-01 → still 2024/25
        assert_eq!(
            term_from_startdate(Some(1740787200)).unwrap().name,
            "2024/25 (PoliMi)"
        );
    }
}
