use crate::state::AppState;
use std::sync::atomic::Ordering;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const ID: &str = "main";

pub fn exists(app: &AppHandle) -> bool {
    app.tray_by_id(ID).is_some()
}

pub fn remove(app: &AppHandle) {
    let _ = app.remove_tray_by_id(ID);
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Apri BlackBoard Sync", true, None::<&str>)?;
    let sync_now = MenuItem::with_id(app, "sync", "Sincronizza ora", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &sync_now, &sep, &quit])?;

    let icon_bytes = include_bytes!("../../static/icons/png/128x128.png");
    let icon = tauri::image::Image::from_bytes(icon_bytes)
        .expect("Failed to load tray icon");

    let builder = TrayIconBuilder::with_id(ID)
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => crate::window::show(app),
            "sync" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::download::trigger_sync(&app).await;
                });
            }
            "quit" => {
                let state = app.state::<AppState>();
                state.is_quitting.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::window::show(tray.app_handle());
            }
        });

    #[cfg(target_os = "macos")]
    let builder = builder.icon_as_template(true);

    builder.build(app)?;
    Ok(())
}
