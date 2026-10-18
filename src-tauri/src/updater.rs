use crate::state::AppState;
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};
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

/// Downloads are verified against the Ed25519 key in tauri.conf.json before installing.
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
    let mut received = 0u64;

    let bytes = update
        .download(
            move |chunk_length, content_length| {
                let total = content_length.unwrap_or(0);
                received += chunk_length as u64;
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
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    // On Windows installing quits the app: let a running sync finish first.
    while app.state::<AppState>().syncing.load(Ordering::SeqCst) {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
    update.install(bytes).map_err(|e| e.to_string())?;

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
