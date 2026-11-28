//! The main window: its label, platform look and size.

use tauri::{AppHandle, Manager};

pub const MAIN: &str = "main";

/// From the tray or a second launch.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The size in tauri.conf.json, which each platform file repeats.
fn default_size(app: &AppHandle) -> Option<(f64, f64)> {
    app.config().app.windows.iter().find(|w| w.label == MAIN).map(|w| (w.width, w.height))
}

pub fn reset_size(app: &AppHandle) -> Result<(), String> {
    let (Some(window), Some((width, height))) = (app.get_webview_window(MAIN), default_size(app))
    else {
        return Ok(());
    };
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    window.center().map_err(|e| e.to_string())
}

/// Platform look and first-launch size, then shown when `visible`.
pub fn setup(app: &AppHandle, visible: bool) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE,
            DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        };

        if let Ok(hwnd) = window.hwnd() {
            let hwnd = hwnd.0 as windows_sys::Win32::Foundation::HWND;

            // Rounded corners (Win11, ignored on Win10) without DwmExtendFrameIntoClientArea,
            // whose frame brings a gray border and native caption buttons.
            let corner = DWMWCP_ROUND;
            // Removes the gray border Win11 paints around every window.
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

            // Win11 draws BLURBEHIND unblurred, so it gets the acrylic accent. The tint is
            // CSS (--bg-veil, follows the theme); alpha 1, as some builds drop acrylic at 0.
            let win11 = windows_build_number() >= 22000;
            if !(win11 && apply_accent_acrylic(hwnd, (10, 14, 20, 1))) {
                let _ = window_vibrancy::apply_blur(&window, Some((10, 14, 20, 1)));
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

    // First launch only (no window-state file yet): the configured size clamped to the work
    // area, since a 1080p notebook at 150% has only ~690 logical px of height.
    let first_run = app
        .path()
        .app_config_dir()
        .map(|dir| !dir.join(tauri_plugin_window_state::DEFAULT_FILENAME).exists())
        .unwrap_or(false);
    if let (true, Some((mut width, mut height))) = (first_run, default_size(app)) {
        let scale = window.scale_factor().unwrap_or(1.0);
        if let Ok(Some(monitor)) = window.current_monitor() {
            let work = monitor.work_area();
            width = width.min(work.size.width as f64 / scale - 16.0);
            height = height.min(work.size.height as f64 / scale - 16.0);
        }
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
        let _ = window.center();
    }

    if visible {
        let _ = window.show();
    }
}

/// Via RtlGetVersion: GetVersionExW misreports Win10/11 without a supportedOS manifest. 0 on failure.
#[cfg(target_os = "windows")]
fn windows_build_number() -> u32 {
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};

    #[repr(C)]
    #[allow(non_snake_case, clippy::upper_case_acronyms)]
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
        let Some(proc) = GetProcAddress(module, c"RtlGetVersion".as_ptr().cast()) else {
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

/// Acrylic via the undocumented SetWindowCompositionAttribute: the only one that paints on
/// a frameless window without DwmExtendFrameIntoClientArea. Color is the RGBA tint.
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
        let Some(proc) = GetProcAddress(module, c"SetWindowCompositionAttribute".as_ptr().cast())
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
