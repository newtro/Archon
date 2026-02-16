use std::sync::Mutex;
use tauri::Manager;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri_plugin_fs::FsExt;

/// Holds a reference to the tray status menu item so the frontend can update it.
struct TrayState {
    status_item: MenuItem<tauri::Wry>,
}

/// Grant the frontend read access to a directory (and all children) at runtime.
/// This is needed when restoring a previously-opened project on app restart,
/// because the dialog-granted scope does not persist across sessions.
#[tauri::command]
fn allow_directory_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())
}

/// Update the tray menu status text from the frontend (e.g. "Gateway: Connected (https://...)").
#[tauri::command]
fn update_tray_status(app: tauri::AppHandle, status: String) -> Result<(), String> {
    let tray_state = app.state::<Mutex<TrayState>>();
    let state = tray_state.lock().map_err(|e| e.to_string())?;
    state.status_item.set_text(&status).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:archon.db", vec![])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![allow_directory_scope, update_tray_status])
        .on_window_event(|window, event| {
            // Close-to-tray: hide the window instead of closing so the gateway stays alive
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            // ── System tray ────────────────────────────────────────
            let status_item = MenuItem::with_id(app, "status", "Gateway: Stopped", false, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Archon", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status_item, &separator, &show_item, &quit_item])?;

            // Store the status item so update_tray_status can modify it
            app.manage(Mutex::new(TrayState {
                status_item: status_item.clone(),
            }));

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Archon IDE")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
