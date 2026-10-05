//! WeBeep (Politecnico di Milano) — Moodle web-service client.
//!
//! Unlike Blackboard, which is driven with SAML session cookies, Moodle's REST
//! API is token-based. The token is obtained once through the site's own mobile
//! launch flow: we open Polimi's Shibboleth SSO in a webview, the user signs in
//! there, and Moodle hands back a token via a `moodlemobile://` redirect that we
//! intercept. The Polimi password therefore never passes through this process.

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

/// Moodle ids are small integers, so they are prefixed to keep every existing
/// config list (`enabledCourses`, `hiddenCourses`, `courseAliases`) usable for
/// both universities with no migration.
pub const ID_PREFIX: &str = "webeep:";

/// Every SSO window is labelled with this prefix plus its passport, so a stale
/// window can be found and reclaimed without touching a concurrent attempt.
const WINDOW_PREFIX: &str = "webeep-login-";

// ── Wire types ────────────────────────────────────────────────

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
}

/// Moodle answers errors with HTTP 200 and this shape, so every response has to
/// be sniffed for it before being decoded as the expected payload.
#[derive(Deserialize)]
struct MoodleError {
    errorcode: String,
    message: String,
}

// ── Client ────────────────────────────────────────────────────

#[derive(Clone)]
pub struct WeBeepAPI {
    client: Client,
    token: String,
}

impl WeBeepAPI {
    pub fn new(token: &str) -> Self {
        let client = Client::builder()
            .user_agent(USER_AGENT)
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
            .map_err(|e| e.to_string())?
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

        // The serde error names the offending field and offset, which is what
        // pins down a shape mismatch; the body itself is not logged, since it
        // is the user's own course data.
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

    /// Moodle file URLs are only readable with the token appended as a query
    /// parameter; they already carry their own `?forcedownload=1`, so the pair
    /// is appended through the URL parser rather than by string concatenation.
    /// The host check keeps a tampered API response from redirecting the token
    /// to a third-party server.
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
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        Ok(resp)
    }
}

// ── Course mapping ────────────────────────────────────────────

pub fn is_webeep(course_id: &str) -> bool {
    course_id.starts_with(ID_PREFIX)
}

fn numeric_id(course_id: &str) -> Option<i64> {
    course_id.strip_prefix(ID_PREFIX)?.parse().ok()
}

/// Builds a term from the first year of an academic year pair.
///
/// The label carries the university, because the two sit in the same course
/// list and Blackboard terms are worded differently ("2026/2027 FIRST
/// SEMESTER"); a bare "2026/27" next to them reads as just another Bocconi
/// term. The id stays namespaced by ID_PREFIX, so `hiddenTerms` and
/// `collapsedTerms` are unaffected by the wording.
fn academic_term(start_year: i32) -> crate::blackboard::Term {
    crate::blackboard::Term {
        id: format!("{}term:{}", ID_PREFIX, start_year),
        name: format!("{}/{:02} (PoliMi)", start_year, (start_year + 1) % 100),
    }
}

/// WeBeep course names carry the academic year they are taught in, in brackets
/// at the end: "054323 - INTERNET OF THINGS (CESANA MATTEO) [2026-27]".
///
/// This is the authoritative source. `startdate` records when the Moodle space
/// was created, which is routinely a year earlier than the year the course is
/// actually offered, so deriving the term from it files courses under the wrong
/// academic year.
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

/// Fallback for courses whose name carries no year: Moodle has no Term concept,
/// so the academic year is derived from the start date with a September
/// rollover. Less accurate than the name, hence second choice.
fn term_from_startdate(startdate: Option<i64>) -> Option<crate::blackboard::Term> {
    use chrono::Datelike;
    let ts = startdate.filter(|t| *t > 0)?;
    let date = chrono::DateTime::from_timestamp(ts, 0)?;
    let (year, month) = (date.year(), date.month());
    Some(academic_term(if month >= 9 { year } else { year - 1 }))
}

/// Presents the WeBeep account through the same shape the UI already uses for
/// the Blackboard account, so the header and login views need no second type.
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

/// Capitalises one name: "BINOSI" -> "Binosi", "D'AMICO" -> "D'Amico".
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
            // An apostrophe or hyphen starts a new name part.
            out.push(c);
            at_start = true;
        }
    }
    out
}

/// Reformats one WeBeep teacher into the "Given Family" order Blackboard uses,
/// so both universities read the same way in the course list.
///
/// ponytail: the last word is taken as the given name ("DE MARIA ALESSANDRO" ->
/// "Alessandro De Maria"). Someone recorded with two given names comes out
/// scrambled; WeBeep exposes no structured teacher fields to do better, and the
/// alias rename in the UI is the escape hatch.
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

/// Splits a WeBeep course title into the parts the UI shows separately:
///
/// "056896 - OFFENSIVE AND DEFENSIVE CYBERSECURITY (BINOSI LORENZO) [2026-27]"
///   -> ("OFFENSIVE AND DEFENSIVE CYBERSECURITY", Some("Lorenzo Binosi"))
///
/// The course code, teacher and academic year are all encoded into one string
/// by WeBeep. Pulling them apart keeps the teacher on its own line as with
/// Blackboard courses, and keeps the sync folder name short — the whole title
/// would otherwise eat into the Windows 260-character path limit once Moodle
/// sections and subfolders are nested under it.
fn split_course_title(fullname: &str) -> (String, Option<String>) {
    let mut rest = fullname.trim();

    // Trailing "[2026-27]" — already consumed by term_from_name.
    if rest.ends_with(']') {
        if let Some(open) = rest.rfind('[') {
            rest = rest[..open].trim_end();
        }
    }

    // Trailing "(BINOSI LORENZO)", possibly several separated by commas.
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

    // Leading course code, "056896 - ".
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

// ── Scan ──────────────────────────────────────────────────────

/// Walks a course's sections and returns every downloadable file.
///
/// Moodle returns the whole tree in a single call, so unlike Blackboard there is
/// no per-level fan-out to do here.
///
/// Files land directly in the course folder, the way Blackboard course files do.
/// Moodle's own section ("Introduzione") and folder-module ("Course materials")
/// names are dropped: they are organisational labels rather than a directory
/// structure the user built, and keeping them buried every file two levels deep.
/// Only `filepath` survives, because those are real subdirectories created
/// inside a folder module.
///
/// Dropping those levels can make two files collide — the same filename in two
/// sections. Rather than let the caller's dedup silently discard one, a colliding
/// file is put back under its module (and then its section) name until it is
/// unique.
pub async fn scan_course(
    api: &WeBeepAPI,
    course: &crate::blackboard::Course,
    base_path: &str,
) -> Vec<FileToDownload> {
    let Some(id) = numeric_id(&course.id) else {
        return Vec::new();
    };
    let Ok(sections) = api.contents(id).await else {
        return Vec::new();
    };
    files_from_sections(sections, course, base_path)
}

/// Path layout for a course's files, split out from the network call so the
/// collision handling can be tested against fixtures.
fn files_from_sections(
    sections: Vec<Section>,
    course: &crate::blackboard::Course,
    base_path: &str,
) -> Vec<FileToDownload> {
    struct Candidate {
        section: String,
        module: String,
        /// Real subdirectories from inside a Moodle folder module.
        sub: PathBuf,
        name: String,
        url: String,
    }

    let mut candidates: Vec<Candidate> = Vec::new();
    for section in sections {
        for module in section.modules {
            // `url` modules point at external links, not files.
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
                });
            }
        }
    }

    // A path is only worth disambiguating when more than one distinct file wants
    // it; the same file listed twice can keep the flat name.
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
            }
        })
        .collect()
}

// ── Token acquisition (SSO webview) ───────────────────────────

/// 128 bits of OS randomness, hex encoded.
fn random_passport() -> String {
    let mut bytes = [0u8; 16];
    // A failure here means the OS entropy source is unavailable; falling back to
    // anything guessable would silently defeat the nonce, so the caller aborts.
    if getrandom::getrandom(&mut bytes).is_err() {
        return String::new();
    }
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// The signature Moodle returns alongside the token: `md5(wwwroot + passport)`,
/// with the site URL carrying no trailing slash. Verified against live launch
/// payloads from webeep.polimi.it.
fn launch_signature(passport: &str) -> String {
    format!("{:x}", md5::compute(format!("{}{}", SITE, passport)))
}

/// Decodes Moodle's launch payload: base64 of
/// `md5(wwwroot+passport):::token[:::privatetoken]`.
///
/// Both signature inputs are public, so recomputing it only proves the payload
/// belongs to a launch of this site — it is the unguessable passport, not the
/// hash, that ties the token to the window we opened. The token itself is then
/// proven separately by calling `site_info`.
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

/// Opens the Polimi SSO in a dedicated window and resolves once Moodle redirects
/// to `moodlemobile://token=…`. Returns an error if the user closes the window.
pub async fn acquire_token(app: &AppHandle) -> Result<String, String> {
    // The passport has to be a real nonce, not merely unique. Moodle signs it
    // with md5(wwwroot + passport), and both inputs are public, so the signature
    // only proves the payload belongs to *some* launch of this site. A guessable
    // passport would let any page that ends up in this webview mint a payload
    // carrying a token of its choosing. 128 CSPRNG bits removes the guess.
    let passport = random_passport();
    if passport.is_empty() {
        return Err("Impossibile generare un nonce sicuro per l'accesso".to_string());
    }
    let label = format!("{}{}", WINDOW_PREFIX, passport);

    // An abandoned attempt (window left open, SSO never finished) must not lock
    // the feature out until its timeout expires: reclaim any leftover window and
    // start a fresh attempt instead of refusing this one.
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
    // Moodle only ever emits the moodlemobile:// redirect from launch.php, so
    // the hop before it is always on the WeBeep host. The SSO chain legitimately
    // leaves that host (Shibboleth, then whichever SPID provider the user picks),
    // and those hosts cannot be enumerated, so the chain itself stays open —
    // but a page parked on some other host cannot hand us a token.
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
            // Enough to follow the SSO chain when a login stalls. The query and
            // fragment are dropped on purpose: these hops carry SAML tickets and
            // OAuth codes, and the final one carries the Moodle token itself.
            eprintln!("[webeep] nav: {}://{}{}", url.scheme(), url.host_str().unwrap_or("-"), url.path());
            *nav_host.lock().unwrap() = url.host_str().map(|h| h.to_string());
            return true;
        }

        if nav_host.lock().unwrap().as_deref() != Some(HOST) {
            eprintln!("[webeep] token offerto da un'origine inattesa, ignorato");
            return false;
        }
        // `moodlemobile://token=<base64>` has no valid authority, so the payload
        // is taken off the raw string rather than via Url accessors.
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

/// Loads the stored token and verifies it still works.
///
/// `Ok(None)` means WeBeep was never connected or is paused in Settings, both
/// normal states not worth reporting. `Err` means a token is stored but no longer authenticates,
/// which the user does need to see — but as a warning, never as a failure that
/// would take the Blackboard side of the sync down with it.
pub async fn active_api(app: &AppHandle) -> Result<Option<(WeBeepAPI, SiteInfo)>, String> {
    if !app.state::<AppState>().store.lock().unwrap().get_config().webeep_enabled {
        return Ok(None);
    }
    connected_api(app).await
}

/// The connected account whether or not it is paused, for showing who is
/// signed in.
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

    /// Signature taken from a real webeep.polimi.it launch: this pins the
    /// md5(wwwroot + passport) scheme, which a plain passport comparison got
    /// wrong and which no amount of local reasoning would have revealed.
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

    /// A payload minted for a different passport must not be accepted, or the
    /// window binding the token to this request would be worthless.
    #[test]
    fn rejects_mismatched_passport() {
        let raw = base64::engine::general_purpose::STANDARD.encode(format!(
            "{}:::0123456789abcdef0123456789abcdef",
            launch_signature("otherpass")
        ));
        assert!(decode_launch_token(&raw, "pass123").is_err());
    }

    /// The signature formula is public, so the passport is the only thing an
    /// attacker cannot reproduce. It must be unpredictable, not merely unique.
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

    /// Pinned to a real WeBeep course name. The bracketed year is the one the
    /// course is taught in; startdate would have filed this under 2025/26.
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

    /// A title with none of the decorations must survive untouched rather than
    /// collapse to an empty folder name.
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

    /// The layout the user asked for: files sit directly in the course folder,
    /// with Moodle's section and folder-module labels dropped.
    #[test]
    fn files_land_directly_in_the_course_folder() {
        let out = paths(
            r#"[{"name":"Introduzione","modules":[
                 {"name":"Course materials","modname":"folder","contents":[
                   {"type":"file","filename":"slides.pdf","fileurl":"https://webeep.polimi.it/a.pdf","filepath":"/"}]}]}]"#,
        );
        assert_eq!(out, vec!["CORSO/slides.pdf"]);
    }

    /// Subdirectories created inside a Moodle folder are real structure and stay.
    #[test]
    fn keeps_subdirectories_from_filepath() {
        let out = paths(
            r#"[{"name":"Lezioni","modules":[
                 {"name":"Materiale","modname":"folder","contents":[
                   {"type":"file","filename":"es1.pdf","fileurl":"https://webeep.polimi.it/b.pdf","filepath":"/esercizi/settimana1/"}]}]}]"#,
        );
        assert_eq!(out, vec!["CORSO/esercizi/settimana1/es1.pdf"]);
    }

    /// Two different files with the same name would overwrite each other once
    /// the section names are dropped, so both get put back under their module.
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

    /// The same file listed twice is not a collision — it stays flat and the
    /// caller's dedup drops the repeat.
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

    /// External-link modules carry no file and must not produce an entry.
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
