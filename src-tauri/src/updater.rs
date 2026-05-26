use crate::state::AppState;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const GITHUB_API_LATEST: &str =
    "https://api.github.com/repos/Clav3rbot/BlackBoardSync/releases/latest";
const USER_AGENT: &str = "BlackBoardSync";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    status: String,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    percent: u32,
    received: u64,
    total: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdateReady {
    release_name: String,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GitRef {
    object: GitObject,
}

#[derive(Deserialize)]
struct GitObject {
    sha: String,
    #[serde(rename = "type")]
    obj_type: String,
    url: String,
}

pub async fn check_for_updates_internal(app: &AppHandle) {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    emit_status(app, "checking", "Controllo aggiornamenti...");

    match do_check(app, &client).await {
        Ok(()) => {}
        Err(e) => {
            emit_status(app, "error", &format!("Errore aggiornamento: {}", e));
        }
    }
}

async fn do_check(app: &AppHandle, client: &Client) -> Result<(), String> {
    let release: GithubRelease = client
        .get(GITHUB_API_LATEST)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let remote_version = release.tag_name.trim_start_matches('v');
    let local_version = app.package_info().version.to_string();

    let newer = is_newer(remote_version, &local_version);
    let mut same_build = false;

    if !newer && remote_version == local_version {
        // Check commit hash
        let local_commit = option_env!("BUILD_COMMIT_HASH").unwrap_or("");
        if !local_commit.is_empty() {
            let tag_ref_url = format!(
                "https://api.github.com/repos/Clav3rbot/BlackBoardSync/git/ref/tags/{}",
                release.tag_name
            );
            if let Ok(resp) = client.get(&tag_ref_url).send().await {
                if let Ok(git_ref) = resp.json::<GitRef>().await {
                    let mut remote_sha = git_ref.object.sha.clone();

                    // Resolve annotated tags to commit
                    if git_ref.object.obj_type == "tag" {
                        if let Ok(resp2) = client.get(&git_ref.object.url).send().await {
                            if let Ok(tag_obj) = resp2.json::<serde_json::Value>().await {
                                if let Some(sha) = tag_obj["object"]["sha"].as_str() {
                                    remote_sha = sha.to_string();
                                }
                            }
                        }
                    }

                    same_build = remote_sha != local_commit;
                }
            }
        }
    }

    if !newer && !same_build {
        emit_status(app, "not-available", "Nessun aggiornamento disponibile");
        return Ok(());
    }

    // Find Windows setup .exe
    let setup_asset = release
        .assets
        .iter()
        .find(|a| a.name.ends_with(".exe"))
        .ok_or_else(|| "Installer non trovato nella release".to_string())?;

    emit_status(
        app,
        "available",
        &format!(
            "Aggiornamento v{} disponibile! Download in corso...",
            remote_version
        ),
    );

    // Download to temp directory
    let tmp_dir = std::env::temp_dir();
    let setup_path = tmp_dir.join(&setup_asset.name);

    let dl_resp = client
        .get(&setup_asset.browser_download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let content_length = dl_resp
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    use futures_util::StreamExt;
    let mut stream = dl_resp.bytes_stream();
    let mut received: u64 = 0;
    let mut file_bytes: Vec<u8> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file_bytes.extend_from_slice(&chunk);
        received += chunk.len() as u64;

        if content_length > 0 {
            let percent = (received * 100 / content_length) as u32;
            app.emit("update-download-progress", DownloadProgress {
                percent,
                received,
                total: content_length,
            }).ok();
        }
    }

    std::fs::write(&setup_path, &file_bytes).map_err(|e| e.to_string())?;

    {
        let state = app.state::<AppState>();
        let mut pending = state.pending_setup_path.lock().unwrap();
        *pending = Some(setup_path.to_string_lossy().into_owned());
    }

    emit_status(app, "downloaded", "Aggiornamento scaricato. Riavvia per installare.");
    app.emit("update-ready", UpdateReady {
        release_name: format!("v{}", remote_version),
    }).ok();

    Ok(())
}

fn emit_status(app: &AppHandle, status: &str, message: &str) {
    app.emit("update-status", UpdateStatus {
        status: status.to_string(),
        message: message.to_string(),
    }).ok();
}

fn is_newer(remote: &str, local: &str) -> bool {
    let parse = |s: &str| {
        s.split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let r = parse(remote);
    let l = parse(local);
    let max_len = r.len().max(l.len());
    for i in 0..max_len {
        let rv = r.get(i).copied().unwrap_or(0);
        let lv = l.get(i).copied().unwrap_or(0);
        if rv > lv { return true; }
        if rv < lv { return false; }
    }
    false
}
