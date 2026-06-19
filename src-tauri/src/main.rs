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
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Don't persist VISIBLE, else --hidden autostart gets overridden and the window shows
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
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
                    use windows_sys::Win32::Graphics::Dwm::{
                        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE,
                        DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
                    };

                    if let Ok(hwnd) = window.hwnd() {
                        let hwnd = hwnd.0 as windows_sys::Win32::Foundation::HWND;

                        // Rounded corners (Win11+, silently ignored on Win10). Unlike
                        // DwmExtendFrameIntoClientArea this draws no frame, so the
                        // frameless window stays free of the gray DWM border and the
                        // native caption buttons that the sheet-of-glass trick
                        // surfaced under the custom titlebar.
                        let corner = DWMWCP_ROUND;
                        // Win11 paints a subtle gray border around every
                        // top-level window; COLOR_NONE removes it.
                        let border = DWMWA_COLOR_NONE;
                        unsafe {
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                                &corner as *const _ as *const _,
                                std::mem::size_of::<u32>() as u32,
                            );
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWA_BORDER_COLOR as u32,
                                &border as *const _ as *const _,
                                std::mem::size_of::<u32>() as u32,
                            );
                        }

                        // Win11 broke the legacy BLURBEHIND accent — it composites as
                        // plain transparency with no gaussian blur — and the modern DWM
                        // backdrops (Mica / DWMSBT_*) need the frame extension above,
                        // with its border + caption-button artifacts. The acrylic
                        // *accent* goes through the same SetWindowCompositionAttribute
                        // path as BLURBEHIND (paints fine on a frameless window, no
                        // frame artifacts) and still blurs on Win11, giving the
                        // Win10-style glass. Win10 keeps BLURBEHIND untouched.
                        let win11 = windows_build_number() >= 22000;
                        if !(win11 && apply_accent_acrylic(hwnd, (10, 14, 20, 160))) {
                            let _ = window_vibrancy::apply_blur(&window, Some((10, 14, 20, 160)));
                        }
                    }
                }
                #[cfg(target_os = "macos")]
                let _ = window_vibrancy::apply_vibrancy(
                    &window,
                    window_vibrancy::NSVisualEffectMaterial::HudWindow,
                    None,
                    None,
                );

                // First launch only — before tauri-plugin-window-state has ever
                // saved a state file — force the default 480x780 logical size
                // (same as the reset_window_size command), clamped to the
                // monitor work area so it isn't cut off on small scaled screens
                // (a 1080p notebook at 150% has only ~690 logical px of height).
                // On every later launch the plugin restores whatever size the
                // user chose, until they press reset.
                let first_run = app
                    .path()
                    .app_config_dir()
                    .map(|dir| !dir.join(tauri_plugin_window_state::DEFAULT_FILENAME).exists())
                    .unwrap_or(false);
                if first_run {
                    let scale = window.scale_factor().unwrap_or(1.0);
                    let (mut width, mut height) = (480.0_f64, 780.0_f64);
                    if let Ok(Some(monitor)) = window.current_monitor() {
                        let work = monitor.work_area();
                        width = width.min(work.size.width as f64 / scale - 16.0);
                        height = height.min(work.size.height as f64 / scale - 16.0);
                    }
                    let _ = window.set_size(tauri::LogicalSize::new(width, height));
                    let _ = window.center();
                }
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

/// Windows build number via RtlGetVersion (ntdll), which reports the real OS
/// version regardless of the application manifest — GetVersionExW lies about
/// Win10/11 without a supportedOS manifest entry. Returns 0 on failure.
#[cfg(target_os = "windows")]
fn windows_build_number() -> u32 {
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};

    #[repr(C)]
    #[allow(non_snake_case)]
    struct OSVERSIONINFOW {
        dwOSVersionInfoSize: u32,
        dwMajorVersion: u32,
        dwMinorVersion: u32,
        dwBuildNumber: u32,
        dwPlatformId: u32,
        szCSDVersion: [u16; 128],
    }

    unsafe {
        let ntdll: Vec<u16> = "ntdll.dll".encode_utf16().chain(std::iter::once(0)).collect();
        let module = GetModuleHandleW(ntdll.as_ptr());
        if module.is_null() {
            return 0;
        }
        let Some(proc) = GetProcAddress(module, b"RtlGetVersion\0".as_ptr()) else {
            return 0;
        };
        let rtl_get_version: unsafe extern "system" fn(*mut OSVERSIONINFOW) -> i32 =
            std::mem::transmute(proc);
        let mut info: OSVERSIONINFOW = std::mem::zeroed();
        info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
        if rtl_get_version(&mut info) == 0 {
            info.dwBuildNumber
        } else {
            0
        }
    }
}

/// ACCENT_ENABLE_ACRYLICBLURBEHIND via the undocumented
/// SetWindowCompositionAttribute — the only acrylic that paints on a frameless
/// window without DwmExtendFrameIntoClientArea (whose extended frame drags in
/// a gray border + native caption buttons). Color is RGBA tint over the blur.
#[cfg(target_os = "windows")]
fn apply_accent_acrylic(
    hwnd: windows_sys::Win32::Foundation::HWND,
    (r, g, b, a): (u8, u8, u8, u8),
) -> bool {
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};

    #[repr(C)]
    struct AccentPolicy {
        accent_state: u32,
        accent_flags: u32,
        gradient_color: u32, // AABBGGRR
        animation_id: u32,
    }
    #[repr(C)]
    struct WindowCompositionAttribData {
        attrib: u32,
        pv_data: *mut core::ffi::c_void,
        cb_data: usize,
    }
    const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
    const WCA_ACCENT_POLICY: u32 = 19;

    unsafe {
        let user32: Vec<u16> = "user32.dll".encode_utf16().chain(std::iter::once(0)).collect();
        let module = GetModuleHandleW(user32.as_ptr());
        if module.is_null() {
            return false;
        }
        let Some(proc) = GetProcAddress(module, b"SetWindowCompositionAttribute\0".as_ptr())
        else {
            return false;
        };
        let set_window_composition_attribute: unsafe extern "system" fn(
            windows_sys::Win32::Foundation::HWND,
            *mut WindowCompositionAttribData,
        )
            -> windows_sys::Win32::Foundation::BOOL = std::mem::transmute(proc);

        let mut policy = AccentPolicy {
            accent_state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
            accent_flags: 2,
            gradient_color: (r as u32)
                | ((g as u32) << 8)
                | ((b as u32) << 16)
                | ((a as u32) << 24),
            animation_id: 0,
        };
        let mut data = WindowCompositionAttribData {
            attrib: WCA_ACCENT_POLICY,
            pv_data: &mut policy as *mut _ as *mut _,
            cb_data: std::mem::size_of::<AccentPolicy>(),
        };
        set_window_composition_attribute(hwnd, &mut data) != 0
    }
}
