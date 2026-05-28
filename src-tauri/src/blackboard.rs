use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const API_BASE: &str = "https://blackboard.unibocconi.it/learn/api/public/v1";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BlackBoardSync/1.0";
const EXCLUDED_ROLES: &[&str] = &[
    "Student", "Guest", "CourseBuilder", "BbSpectator", "TeachingAssistant", "Grader",
];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserName {
    pub given: String,
    pub family: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub id: String,
    pub user_name: String,
    pub name: UserName,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Term {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: String,
    pub course_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub term: Option<Term>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContentItem {
    pub id: String,
    pub title: String,
    pub has_children: Option<bool>,
    pub content_handler: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub file_name: String,
    pub mime_type: Option<String>,
}

#[derive(Clone)]
pub struct BlackboardAPI {
    client: Client,
}

impl BlackboardAPI {
    pub fn new(cookies: &[String]) -> Self {
        let cookie_header = cookies.join("; ");
        let mut headers = reqwest::header::HeaderMap::new();
        // Build cookie header defensively: a malformed/tampered cookie value
        // (e.g. control chars from a corrupt keyring entry) must not panic the app.
        if let Ok(value) = reqwest::header::HeaderValue::from_str(&cookie_header) {
            headers.insert("Cookie", value);
        }
        if let Ok(ua) = reqwest::header::HeaderValue::from_str(USER_AGENT) {
            headers.insert("User-Agent", ua);
        }

        let client = Client::builder()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to build blackboard client");

        Self { client }
    }

    fn url(&self, path: &str) -> String {
        if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", API_BASE, path)
        }
    }

    pub async fn get_current_user(&self) -> Result<UserInfo, String> {
        self.client
            .get(self.url("/users/me"))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json::<UserInfo>()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_courses(&self, user_id: &str) -> Result<Vec<Course>, String> {
        self.get_courses_inner(user_id, true).await
    }

    pub async fn get_courses_for_sync(&self, user_id: &str) -> Result<Vec<Course>, String> {
        self.get_courses_inner(user_id, false).await
    }

    async fn get_courses_inner(&self, user_id: &str, fetch_instructors: bool) -> Result<Vec<Course>, String> {
        let mut courses: Vec<Course> = Vec::new();
        let mut path = format!(
            "/users/{}/courses?limit=100&fields=courseId,course.name,course.id,course.termId",
            user_id
        );

        // Paginate
        loop {
            let data: serde_json::Value = self.client
                .get(self.url(&path))
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;

            if let Some(results) = data["results"].as_array() {
                for membership in results {
                    let course_obj = &membership["course"];
                    let id = course_obj["id"].as_str().unwrap_or("").to_string();
                    if id.is_empty() { continue; }

                    let course_id = membership["courseId"].as_str().unwrap_or("").to_string();
                    let name = course_obj["name"]
                        .as_str()
                        .unwrap_or(&course_id)
                        .to_string();

                    let term = course_obj["termId"].as_str().map(|term_id| Term {
                        id: term_id.to_string(),
                        name: String::new(),
                    });

                    courses.push(Course { id, course_id, name, term, instructor: None });
                }
            }

            match data["paging"]["nextPage"].as_str() {
                Some(next) => path = next.to_string(),
                None => break,
            }
        }

        // Resolve term names
        let term_ids: Vec<String> = courses
            .iter()
            .filter_map(|c| c.term.as_ref().map(|t| t.id.clone()))
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        let term_fetches = term_ids.iter().map(|term_id| {
            let client = self.client.clone();
            let url = self.url(&format!("/terms/{}", term_id));
            let term_id = term_id.clone();
            async move {
                if let Ok(resp) = client.get(&url).send().await {
                    if let Ok(json) = resp.json::<serde_json::Value>().await {
                        let name = json["name"].as_str().unwrap_or(&term_id).to_string();
                        return Some((term_id, name));
                    }
                }
                None
            }
        });
        let mut term_names: HashMap<String, String> = HashMap::new();
        for entry in futures_util::future::join_all(term_fetches).await.into_iter().flatten() {
            term_names.insert(entry.0, entry.1);
        }

        for course in &mut courses {
            if let Some(term) = &mut course.term {
                if let Some(name) = term_names.get(&term.id) {
                    term.name = name.clone();
                }
            }
        }

        if !fetch_instructors {
            return Ok(courses);
        }

        // Load instructors in batches of 5
        let batch_size = 5;
        for chunk in courses.chunks_mut(batch_size) {
            let mut handles = Vec::new();
            for course in chunk.iter() {
                let course_id = course.id.clone();
                let client = self.client.clone();
                let h = tokio::spawn(async move {
                    let url = format!(
                        "{}/courses/{}/users?limit=200&fields=userId,courseRoleId",
                        API_BASE, course_id
                    );
                    let data = match client.get(&url).send().await {
                        Ok(r) => match r.json::<serde_json::Value>().await {
                            Ok(j) => j,
                            Err(_) => return (course_id, None),
                        },
                        Err(_) => return (course_id, None),
                    };

                    let results = data["results"].as_array().cloned().unwrap_or_default();
                    let instructor_ids: Vec<String> = results
                        .iter()
                        .filter(|m| {
                            m["courseRoleId"]
                                .as_str()
                                .map(|r| !EXCLUDED_ROLES.contains(&r))
                                .unwrap_or(false)
                        })
                        .filter_map(|m| m["userId"].as_str().map(|s| s.to_string()))
                        .collect();

                    if instructor_ids.is_empty() {
                        return (course_id, None);
                    }

                    let name_fetches = instructor_ids.iter().map(|uid| {
                        let client = client.clone();
                        let url = format!(
                            "{}/courses/{}/users/{}?expand=user",
                            API_BASE, course_id, uid
                        );
                        async move {
                            if let Ok(r) = client.get(&url).send().await {
                                if let Ok(m) = r.json::<serde_json::Value>().await {
                                    let given = m["user"]["name"]["given"].as_str().unwrap_or("");
                                    let family = m["user"]["name"]["family"].as_str().unwrap_or("");
                                    let full = format!("{} {}", given, family).trim().to_string();
                                    if !full.is_empty() {
                                        return Some(full);
                                    }
                                }
                            }
                            None
                        }
                    });
                    // join_all preserves order, so consecutive-dedup stays valid.
                    let mut names: Vec<String> = futures_util::future::join_all(name_fetches)
                        .await
                        .into_iter()
                        .flatten()
                        .collect();
                    names.dedup();
                    let instructor = if names.is_empty() { None } else { Some(names.join(", ")) };
                    (course_id, instructor)
                });
                handles.push(h);
            }

            let results: Vec<_> = futures_util::future::join_all(handles).await;
            for result in results {
                if let Ok((course_id, instructor)) = result {
                    if let Some(course) = chunk.iter_mut().find(|c| c.id == course_id) {
                        course.instructor = instructor;
                    }
                }
            }
        }

        Ok(courses)
    }

    pub async fn get_contents(&self, course_id: &str) -> Result<Vec<ContentItem>, String> {
        let mut data: serde_json::Value = self.client
            .get(self.url(&format!("/courses/{}/contents", course_id)))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        let items: Vec<ContentItem> = serde_json::from_value(
            data["results"].take(),
        ).unwrap_or_default();
        Ok(items)
    }

    pub async fn get_children(
        &self,
        course_id: &str,
        content_id: &str,
    ) -> Result<Vec<ContentItem>, String> {
        let mut data: serde_json::Value = self.client
            .get(self.url(&format!(
                "/courses/{}/contents/{}/children",
                course_id, content_id
            )))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        Ok(serde_json::from_value(data["results"].take()).unwrap_or_default())
    }

    pub async fn get_attachments(
        &self,
        course_id: &str,
        content_id: &str,
    ) -> Result<Vec<Attachment>, String> {
        let mut data: serde_json::Value = self.client
            .get(self.url(&format!(
                "/courses/{}/contents/{}/attachments",
                course_id, content_id
            )))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        Ok(serde_json::from_value(data["results"].take()).unwrap_or_default())
    }

    pub async fn download_file(
        &self,
        course_id: &str,
        content_id: &str,
        attachment_id: &str,
    ) -> Result<(Vec<u8>, String), String> {
        let url = self.url(&format!(
            "/courses/{}/contents/{}/attachments/{}/download",
            course_id, content_id, attachment_id
        ));

        let response = self.client
            .get(url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let content_disp = response
            .headers()
            .get("content-disposition")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let file_name = extract_filename(&content_disp).unwrap_or_else(|| "unknown".to_string());
        let data = response.bytes().await.map_err(|e| e.to_string())?.to_vec();

        Ok((data, file_name))
    }
}

fn extract_filename(content_disposition: &str) -> Option<String> {
    let pos = content_disposition.find("filename")?;
    let rest = &content_disposition[pos + 8..];
    let rest = rest.trim_start_matches(|c: char| c != '=').trim_start_matches('=');
    let filename = rest.trim().trim_matches('"').trim_matches('\'');
    let filename = filename.split(';').next()?.trim().trim_matches('"');
    if filename.is_empty() { None } else { Some(filename.to_string()) }
}
