use crate::blackboard::{BlackboardAPI, HOST, SITE};
use crate::model::UserInfo;
use crate::state::{AppState, Session};
use reqwest::{Client, Method, StatusCode};
use scraper::{Html, Selector};
use std::collections::HashMap;
use url::Url;

const MAX_HOPS: u32 = 25;

pub enum SignInError {
    /// The SAML login failed; the text is ready for the user.
    Rejected(String),
    /// Cookies came back but `/users/me` refused them.
    NoProfile(String),
}

/// SAML login, then `/users/me` to prove the cookies; the session goes to memory and the keyring.
pub async fn sign_in(
    state: &AppState,
    username: &str,
    password: &str,
) -> Result<(BlackboardAPI, UserInfo), SignInError> {
    let cookies = LoginManager::new()
        .login(username, password)
        .await
        .map_err(SignInError::Rejected)?;
    let api = BlackboardAPI::new(&cookies);
    let user = api.get_current_user().await.map_err(SignInError::NoProfile)?;
    *state.session.lock().unwrap() = Some(Session { cookies: cookies.clone() });
    state.store.lock().unwrap().save_session(&cookies);
    Ok((api, user))
}

/// `sign_in` with the credentials in the keyring; `None` when there are none.
pub async fn sign_in_again(
    state: &AppState,
) -> Option<Result<(BlackboardAPI, UserInfo), SignInError>> {
    let (username, password) = state.store.lock().unwrap().load_credentials()?;
    Some(sign_in(state, &username, &password).await)
}

/// An expired cookie gets an HTML login page (a JSON decode error), so a failed `/users/me`
/// probe triggers a SAML re-auth with the stored credentials and saves the new session.
pub async fn ensure_valid_session(
    state: &AppState,
    session: &Session,
) -> Result<(BlackboardAPI, UserInfo), String> {
    let probe = BlackboardAPI::new(&session.cookies);
    if let Ok(user) = probe.get_current_user().await {
        return Ok((probe, user));
    }

    match sign_in_again(state).await {
        Some(Ok(signed_in)) => Ok(signed_in),
        Some(Err(SignInError::Rejected(e))) => Err(e),
        None | Some(Err(SignInError::NoProfile(_))) => {
            Err("Sessione scaduta. Rieffettua il login.".to_string())
        }
    }
}

struct CookieJar {
    cookies: HashMap<String, HashMap<String, String>>,
}

impl CookieJar {
    fn new() -> Self {
        Self { cookies: HashMap::new() }
    }

    fn process_response(&mut self, url: &str, headers: &reqwest::header::HeaderMap) {
        let hostname = match Url::parse(url) {
            Ok(u) => u.host_str().unwrap_or("").to_string(),
            Err(_) => return,
        };
        if hostname.is_empty() { return; }

        let jar = self.cookies.entry(hostname).or_default();
        for value in headers.get_all("set-cookie").iter() {
            if let Ok(cookie_str) = value.to_str() {
                let cookie_part = cookie_str.split(';').next().unwrap_or("");
                if let Some(eq_pos) = cookie_part.find('=') {
                    let name = cookie_part[..eq_pos].trim().to_string();
                    let val = cookie_part[eq_pos + 1..].trim().to_string();
                    jar.insert(name, val);
                }
            }
        }
    }

    fn get_cookie_header(&self, url: &str) -> String {
        let hostname = Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_string()))
            .unwrap_or_default();
        let jar = match self.cookies.get(&hostname) {
            Some(j) if !j.is_empty() => j,
            _ => return String::new(),
        };
        jar.iter()
            .map(|(n, v)| format!("{}={}", n, v))
            .collect::<Vec<_>>()
            .join("; ")
    }

    fn get_session_cookies(&self, hostname: &str) -> Vec<String> {
        self.cookies
            .get(hostname)
            .map(|jar| jar.iter().map(|(n, v)| format!("{}={}", n, v)).collect())
            .unwrap_or_default()
    }
}

pub struct LoginManager {
    jar: CookieJar,
    client: Client,
}

impl LoginManager {
    pub fn new() -> Self {
        let client = crate::http::client()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("Failed to build HTTP client");
        Self { jar: CookieJar::new(), client }
    }

    /// Redirects are followed by hand so every hop's cookies reach the jar. A body is a POSTed form.
    async fn request(
        &mut self,
        url: &str,
        form: Option<String>,
    ) -> Result<(reqwest::Response, String), String> {
        let mut current_url = url.to_string();
        let mut current_method = if form.is_some() { Method::POST } else { Method::GET };
        let mut current_body = form;
        let mut hops = MAX_HOPS;

        loop {
            if hops == 0 {
                return Err("Troppi redirect durante il login".to_string());
            }
            hops -= 1;

            let cookie_str = self.jar.get_cookie_header(&current_url);
            let mut builder = self.client
                .request(current_method.clone(), &current_url);

            if !cookie_str.is_empty() {
                builder = builder.header("Cookie", &cookie_str);
            }
            if let Some(body) = &current_body {
                builder = builder
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .body(body.clone());
            }

            let response = builder.send().await.map_err(|e| e.to_string())?;
            let status = response.status();
            self.jar.process_response(&current_url, response.headers());

            if is_redirect(status) {
                let location = response
                    .headers()
                    .get("location")
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| "Redirect senza Location header".to_string())?;

                let next = Url::parse(location)
                    .or_else(|_| Url::parse(&current_url).and_then(|base| base.join(location)))
                    .map_err(|e| e.to_string())?;

                if next.scheme() != "https" {
                    return Err("Redirect verso URL non-HTTPS bloccato".to_string());
                }

                current_url = next.to_string();
                if status == StatusCode::SEE_OTHER || current_method == Method::POST {
                    current_method = Method::GET;
                    current_body = None;
                }
                continue;
            }

            return Ok((response, current_url));
        }
    }

    /// The page at the end of the redirects, and its URL.
    async fn page(&mut self, url: &str, form: Option<String>) -> Result<(String, String), String> {
        let (response, final_url) = self.request(url, form).await?;
        Ok((response.text().await.map_err(|e| e.to_string())?, final_url))
    }

    pub async fn login(&mut self, username: &str, password: &str) -> Result<Vec<String>, String> {
        self.jar = CookieJar::new();

        // Step 1: GET /ultra/course → get SAML form
        let (page, url) = self.page(&format!("{}/ultra/course", SITE), None).await?;
        let (saml_url, saml_body) = {
            let doc = Html::parse_document(&page);
            let action = form_action(&doc)
                .ok_or("Impossibile trovare il form SAML. Il flusso SSO potrebbe essere cambiato.")?;
            let saml_request = input_value(&doc, "SAMLRequest").ok_or("SAMLRequest non trovato")?;
            let relay_state = input_value(&doc, "RelayState").unwrap_or("");
            (
                resolve(action, &url)?,
                form_body(&[("SAMLRequest", saml_request), ("RelayState", relay_state)]),
            )
        };

        // Step 2: POST SAMLRequest to IdP
        let (page, url) = self.page(&saml_url, Some(saml_body)).await?;
        let login_url = {
            let doc = Html::parse_document(&page);
            let action = form_action(&doc).ok_or("Impossibile trovare il form di login nell'IDP.")?;
            resolve(action, &url)?
        };
        let credentials = form_body(&[
            ("j_username", username),
            ("j_password", password),
            ("_eventId_proceed", ""),
        ]);

        // Step 3: POST credentials
        let (page, url) = self.page(&login_url, Some(credentials)).await?;
        let (return_url, return_body) = {
            let doc = Html::parse_document(&page);
            if let Some(error) = doc.select(&selector(".error")).next() {
                let text = error.text().collect::<String>().trim().to_string();
                return Err(if text.is_empty() { "Credenziali non valide".to_string() } else { text });
            }

            // Step 4: POST SAMLResponse back to SP
            let saml_response = input_value(&doc, "SAMLResponse")
                .ok_or("Autenticazione fallita. Nessuna risposta SAML ricevuta.")?;
            let relay_state = input_value(&doc, "RelayState").unwrap_or("");
            let action = form_action(&doc).ok_or("Form SAMLResponse non trovato")?;
            (
                resolve(action, &url)?,
                form_body(&[("SAMLResponse", saml_response), ("RelayState", relay_state)]),
            )
        };
        self.request(&return_url, Some(return_body)).await?;

        let session_cookies = self.jar.get_session_cookies(HOST);
        if session_cookies.is_empty() {
            return Err("Login riuscito ma nessun cookie di sessione ricevuto.".to_string());
        }

        Ok(session_cookies)
    }
}

fn selector(css: &str) -> Selector {
    Selector::parse(css).expect("fixed selector")
}

/// `action` of the page's first form.
fn form_action(doc: &Html) -> Option<&str> {
    doc.select(&selector("form")).next()?.value().attr("action")
}

fn input_value<'a>(doc: &'a Html, name: &str) -> Option<&'a str> {
    doc.select(&selector(&format!(r#"input[name="{}"]"#, name)))
        .next()?
        .value()
        .attr("value")
}

/// An absolute `action` is taken as is, a relative one against the page it came from.
fn resolve(action: &str, page_url: &str) -> Result<String, String> {
    if action.starts_with("http") {
        return Ok(action.to_string());
    }
    Url::parse(page_url)
        .and_then(|base| base.join(action))
        .map(|u| u.to_string())
        .map_err(|e| e.to_string())
}

fn form_body(pairs: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs).finish()
}

fn is_redirect(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::MOVED_PERMANENTLY
            | StatusCode::FOUND
            | StatusCode::SEE_OTHER
            | StatusCode::TEMPORARY_REDIRECT
            | StatusCode::PERMANENT_REDIRECT
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAML_PAGE: &str = r#"<html><body><form method="post" action="/idp/profile/SAML2/POST/SSO"><input type="hidden" name="SAMLRequest" value="PHNhbWw+"/><input type="hidden" name="RelayState" value="cookie&amp;1"/></form></body></html>"#;

    #[test]
    fn reads_the_saml_form() {
        let doc = Html::parse_document(SAML_PAGE);
        assert_eq!(form_action(&doc), Some("/idp/profile/SAML2/POST/SSO"));
        assert_eq!(input_value(&doc, "SAMLRequest"), Some("PHNhbWw+"));
        assert_eq!(input_value(&doc, "RelayState"), Some("cookie&1"));
        assert_eq!(input_value(&doc, "SAMLResponse"), None);
    }

    #[test]
    fn form_actions_resolve_against_their_page() {
        assert_eq!(resolve("/idp/sso", "https://idp.example/start?x=1").unwrap(), "https://idp.example/idp/sso");
        assert_eq!(resolve("https://bb.example/acs", "https://idp.example/x").unwrap(), "https://bb.example/acs");
        assert_eq!(form_body(&[("SAMLResponse", "a+b="), ("RelayState", "")]), "SAMLResponse=a%2Bb%3D&RelayState=");
    }
}
