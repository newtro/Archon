use tauri::Manager;
use tauri_plugin_fs::FsExt;

/// Grant the frontend read access to a directory (and all children) at runtime.
/// This is needed when restoring a previously-opened project on app restart,
/// because the dialog-granted scope does not persist across sessions.
#[tauri::command]
fn allow_directory_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())
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
        .invoke_handler(tauri::generate_handler![allow_directory_scope])
        .setup(|app| {
            let _window = app.get_webview_window("main").unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
