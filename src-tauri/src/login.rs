use reqwest::{Client, Method, StatusCode};
use scraper::{Html, Selector};
use serde::Serialize;
use std::collections::HashMap;
use url::Url;

const BASE_URL: &str = "https://blackboard.unibocconi.it";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BlackBoardSync/1.0";
const MAX_HOPS: u32 = 25;

#[derive(Debug, Serialize)]
pub struct LoginResult {
    pub success: bool,
    pub cookies: Vec<String>,
    pub error: Option<String>,
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

        let jar = self.cookies.entry(hostname).or_insert_with(HashMap::new);
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
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to build HTTP client");
        Self { jar: CookieJar::new(), client }
    }

    async fn request(
        &mut self,
        method: Method,
        url: &str,
        body: Option<String>,
        content_type: Option<&str>,
        follow_redirects: bool,
    ) -> Result<(reqwest::Response, String), String> {
        let mut current_url = url.to_string();
        let mut current_method = method;
        let mut current_body = body;
        let mut hops = MAX_HOPS;

        loop {
            if hops == 0 {
                return Err("Troppi redirect durante il login".to_string());
            }
            hops -= 1;

            let cookie_str = self.jar.get_cookie_header(&current_url);
            let mut builder = self.client
                .request(current_method.clone(), &current_url)
                .header("User-Agent", USER_AGENT);

            if !cookie_str.is_empty() {
                builder = builder.header("Cookie", &cookie_str);
            }
            if let (Some(ref body), Some(ct)) = (&current_body, content_type) {
                builder = builder.header("Content-Type", ct).body(body.clone());
            }

            let response = builder.send().await.map_err(|e| e.to_string())?;
            let status = response.status();
            self.jar.process_response(&current_url, response.headers());

            if follow_redirects && is_redirect(status) {
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

    pub async fn login(&mut self, username: &str, password: &str) -> LoginResult {
        match self.do_login(username, password).await {
            Ok(cookies) => LoginResult { success: true, cookies, error: None },
            Err(e) => LoginResult { success: false, cookies: vec![], error: Some(e) },
        }
    }

    async fn do_login(&mut self, username: &str, password: &str) -> Result<Vec<String>, String> {
        self.jar = CookieJar::new();

        // Step 1: GET /ultra/course → get SAML form
        let (step1_resp, step1_url) = self
            .request(Method::GET, &format!("{}/ultra/course", BASE_URL), None, None, true)
            .await?;

        let body1 = step1_resp.text().await.map_err(|e| e.to_string())?;
        
        let (saml_url, saml_body) = {
            let doc1 = Html::parse_document(&body1);
            let form_sel = Selector::parse("form").unwrap();
            let saml_req_sel = Selector::parse(r#"input[name="SAMLRequest"]"#).unwrap();
            let relay_sel = Selector::parse(r#"input[name="RelayState"]"#).unwrap();

            let form = doc1.select(&form_sel).next();
            let saml_action = form
                .and_then(|f| f.value().attr("action"))
                .ok_or_else(|| "Impossibile trovare il form SAML. Il flusso SSO potrebbe essere cambiato.".to_string())?;
            let saml_request = doc1.select(&saml_req_sel)
                .next()
                .and_then(|e| e.value().attr("value"))
                .ok_or_else(|| "SAMLRequest non trovato".to_string())?;
            let relay_state = doc1.select(&relay_sel)
                .next()
                .and_then(|e| e.value().attr("value"))
                .unwrap_or("");

            let saml_url = if saml_action.starts_with("http") {
                saml_action.to_string()
            } else {
                Url::parse(&step1_url)
                    .and_then(|base| base.join(saml_action))
                    .map(|u| u.to_string())
                    .map_err(|e| e.to_string())?
            };

            let saml_body = url::form_urlencoded::Serializer::new(String::new())
                .append_pair("SAMLRequest", saml_request)
                .append_pair("RelayState", relay_state)
                .finish();

            (saml_url, saml_body)
        };

        // Step 2: POST SAMLRequest to IdP
        let (step2_resp, step2_url) = self
            .request(
                Method::POST,
                &saml_url,
                Some(saml_body),
                Some("application/x-www-form-urlencoded"),
                true,
            )
            .await?;

        let body2 = step2_resp.text().await.map_err(|e| e.to_string())?;
        
        let login_url = {
            let doc2 = Html::parse_document(&body2);
            let form_sel = Selector::parse("form").unwrap();
            let login_action = doc2.select(&form_sel)
                .next()
                .and_then(|f| f.value().attr("action"))
                .ok_or_else(|| "Impossibile trovare il form di login nell'IDP.".to_string())?;

            if login_action.starts_with("http") {
                login_action.to_string()
            } else {
                Url::parse(&step2_url)
                    .and_then(|base| base.join(login_action))
                    .map(|u| u.to_string())
                    .map_err(|e| e.to_string())?
            }
        };

        let cred_body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("j_username", username)
            .append_pair("j_password", password)
            .append_pair("_eventId_proceed", "")
            .finish();

        // Step 3: POST credentials
        let (step3_resp, step3_url) = self
            .request(
                Method::POST,
                &login_url,
                Some(cred_body),
                Some("application/x-www-form-urlencoded"),
                true,
            )
            .await?;

        let body3 = step3_resp.text().await.map_err(|e| e.to_string())?;
        
        let (return_url, return_body) = {
            let doc3 = Html::parse_document(&body3);
            
            // Check for login error
            let error_sel = Selector::parse(".error").unwrap();
            if let Some(error_el) = doc3.select(&error_sel).next() {
                let error_text: String = error_el.text().collect::<Vec<_>>().join("").trim().to_string();
                return Err(if error_text.is_empty() { "Credenziali non valide".to_string() } else { error_text });
            }

            // Step 4: POST SAMLResponse back to SP
            let form_sel = Selector::parse("form").unwrap();
            let saml_resp_sel = Selector::parse(r#"input[name="SAMLResponse"]"#).unwrap();
            let relay_ret_sel = Selector::parse(r#"input[name="RelayState"]"#).unwrap();

            let saml_response = doc3.select(&saml_resp_sel)
                .next()
                .and_then(|e| e.value().attr("value"))
                .ok_or_else(|| "Autenticazione fallita. Nessuna risposta SAML ricevuta.".to_string())?;
            let return_relay = doc3.select(&relay_ret_sel)
                .next()
                .and_then(|e| e.value().attr("value"))
                .unwrap_or("");
            let return_action = doc3.select(&form_sel)
                .next()
                .and_then(|f| f.value().attr("action"))
                .ok_or_else(|| "Form SAMLResponse non trovato".to_string())?;

            let return_url = if return_action.starts_with("http") {
                return_action.to_string()
            } else {
                Url::parse(&step3_url)
                    .and_then(|base| base.join(return_action))
                    .map(|u| u.to_string())
                    .map_err(|e| e.to_string())?
            };

            let return_body = url::form_urlencoded::Serializer::new(String::new())
                .append_pair("SAMLResponse", saml_response)
                .append_pair("RelayState", return_relay)
                .finish();

            (return_url, return_body)
        };

        self.request(
            Method::POST,
            &return_url,
            Some(return_body),
            Some("application/x-www-form-urlencoded"),
            true,
        )
        .await?;

        let session_cookies = self.jar.get_session_cookies("blackboard.unibocconi.it");
        if session_cookies.is_empty() {
            return Err("Login riuscito ma nessun cookie di sessione ricevuto.".to_string());
        }

        Ok(session_cookies)
    }
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
