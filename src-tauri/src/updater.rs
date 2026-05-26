use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

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

/// Check for updates using the official Tauri updater plugin.
/// All downloads are cryptographically verified against the Ed25519 public key
/// configured in tauri.conf.json before installation.
pub async fn check_for_updates(app: &AppHandle) {
    emit_status(app, "checking", "Controllo aggiornamenti...");

    match do_check(app).await {
        Ok(()) => {}
        Err(e) => {
            emit_status(app, "error", &format!("Errore aggiornamento: {}", e));
        }
    }
}

async fn do_check(app: &AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    let update = updater.check().await.map_err(|e| e.to_string())?;

    let Some(update) = update else {
        emit_status(app, "not-available", "Nessun aggiornamento disponibile");
        return Ok(());
    };

    let version = update.version.clone();
    emit_status(
        app,
        "available",
        &format!(
            "Aggiornamento v{} disponibile! Download in corso...",
            version
        ),
    );

    let app_clone = app.clone();
    let version_clone = version.clone();

    // Download and install with progress reporting.
    // The plugin automatically verifies the Ed25519 signature before applying.
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let total = content_length.unwrap_or(0) as u64;
                let received = chunk_length as u64;
                let percent = if total > 0 {
                    (received * 100 / total) as u32
                } else {
                    0
                };
                app_clone
                    .emit(
                        "update-download-progress",
                        DownloadProgress {
                            percent,
                            received,
                            total,
                        },
                    )
                    .ok();
            },
            || {
                // Download finished callback
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    emit_status(
        app,
        "downloaded",
        "Aggiornamento scaricato e installato. Riavvia per completare.",
    );
    app.emit(
        "update-ready",
        UpdateReady {
            release_name: format!("v{}", version_clone),
        },
    )
    .ok();

    Ok(())
}

fn emit_status(app: &AppHandle, status: &str, message: &str) {
    app.emit(
        "update-status",
        UpdateStatus {
            status: status.to_string(),
            message: message.to_string(),
        },
    )
    .ok();
}
