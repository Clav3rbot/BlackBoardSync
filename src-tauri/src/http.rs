//! Settings shared by the Blackboard, SAML login and WeBeep clients.

use reqwest::{Client, ClientBuilder, Response};
use std::time::Duration;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BlackBoardSync/1.0";

/// Overrides the clients' 30 s total timeout, which would cut off large videos.
pub const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 60);

/// No Referer, as download URLs carry the WeBeep token. The read timeout catches stalls in
/// downloads, which override the total timeout.
pub fn client() -> ClientBuilder {
    Client::builder()
        .user_agent(USER_AGENT)
        .referer(false)
        .timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(30))
}

/// Non-2xx is an error: an error page read as content would pass for a real listing or file.
pub fn success(response: Response) -> Result<Response, String> {
    let status = response.status();
    if status.is_success() {
        Ok(response)
    } else {
        Err(format!("HTTP {}", status))
    }
}
