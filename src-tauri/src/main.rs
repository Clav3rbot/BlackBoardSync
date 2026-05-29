#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod blackboard;
mod commands;
mod download;
mod login;
mod state;
mod store;
mod tray;
mod updater;

use crate::state::AppState;
use std::sync::atomic::Ordering;
use tauri::{Manager, RunEvent, WindowEvent};

fn main() {

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::auto_login,
            commands::logout,
            commands::get_courses,
            commands::get_instructors,
            commands::get_cached_instructors,
            commands::sync,
            commands::abort_sync,
            commands::get_config,
            commands::update_config,
            commands::select_folder,
            commands::open_folder,
            commands::reset_window_size,
            commands::check_for_updates,
            commands::restart_for_update,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    // Mica on Win11 (smooth), Blur on Win10 (Acrylic lags during drag)
                    if window_vibrancy::apply_mica(&window, Some(true)).is_err() {
                        let _ = window_vibrancy::apply_blur(&window, Some((10, 14, 20, 200)));
                    }
                }
                #[cfg(target_os = "macos")]
                let _ = window_vibrancy::apply_vibrancy(
                    &window,
                    window_vibrancy::NSVisualEffectMaterial::HudWindow,
                    None,
                    None,
                );
            }

            let state = app.state::<AppState>();
            let config = state.store.lock().unwrap().get_config();

            // Create tray if needed
            let start_hidden = std::env::args().any(|a| a == "--hidden");
            if config.minimize_to_tray || start_hidden {
                tray::create_tray(app.handle())?;
            }

            // Show window unless launched hidden
            if !start_hidden {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }

            // Setup auto-sync
            download::setup_auto_sync(app.handle());

            // Sync start-at-login setting
            use tauri_plugin_autostart::ManagerExt;
            if config.start_at_login {
                let _ = app.autolaunch().enable();
            }

            // Schedule update check after 10 seconds
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                updater::check_for_updates(&handle).await;
            });

            // Repeat update check every 4 hours
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let four_hours = tokio::time::Duration::from_secs(4 * 60 * 60);
                loop {
                    tokio::time::sleep(four_hours).await;
                    updater::check_for_updates(&handle).await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let is_quitting = state.is_quitting.load(Ordering::SeqCst);
                if !is_quitting {
                    let minimize = state.store.lock().unwrap().get_config().minimize_to_tray;
                    if minimize {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<AppState>();
                let is_quitting = state.is_quitting.load(Ordering::SeqCst);
                if !is_quitting {
                    // Keep running if tray is active (minimized to tray)
                    let has_tray = app.tray_by_id("main").is_some();
                    if has_tray {
                        api.prevent_exit();
                    }
                }
            }
        });
}
