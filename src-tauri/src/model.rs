//! Shapes shared by both universities and sent to the interface, where src/types.d.ts
//! mirrors them. UserInfo is Blackboard's `/users/me`; WeBeep accounts are mapped onto it.

use serde::{Deserialize, Serialize};

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

/// A remote file and where it goes, relative to the sync folder.
#[derive(Clone)]
pub struct FileToDownload {
    pub course_id: String,
    pub course_name: String,
    pub content_id: String,
    pub attachment_id: String,
    pub file_name: String,
    pub relative_path: String,
    // Ultra body links (signed bbcswebdav) and every WeBeep file; None means a REST attachment.
    pub url: Option<String>,
    pub webeep: bool,
    // Server-side last change, to spot a file re-uploaded under the same name.
    pub stamp: Option<String>,
}
