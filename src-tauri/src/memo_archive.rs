use serde_json::{json, Value};
use tauri::Manager;
use super::{memo_store::MemoRepository, quick_memo::{MemoStore, repository, log}};

fn caller(window: &tauri::WebviewWindow) -> Result<(), String> {
    if !matches!(window.label(), "overlay" | "dashboard" | "archive") { return Err("archive_access_denied".into()); }
    Ok(())
}

fn run(app: &tauri::AppHandle, action: &str, operation: impl FnOnce(&MemoRepository) -> Result<Value, String>) -> Result<Value, String> {
    let store = app.state::<MemoStore>();
    let _gate = store.gate.lock().map_err(|_| "store_busy")?;
    let result = repository(app).and_then(|repo| operation(&repo));
    // Neither filenames, titles nor returned body content are diagnostic data.
    let outcome=match &result { Ok(value) if value["removed"] == false => "saved_remove_failed", Ok(_) => "success", Err(_) => "failed" };
    log(app, "memo_archive_action", json!({"action":action,"outcome":outcome}));
    result
}

#[tauri::command]
pub async fn list_memo_archives(app: tauri::AppHandle, window: tauri::WebviewWindow, offset: usize) -> Result<Value, String> {
    caller(&window)?;
    tauri::async_runtime::spawn_blocking(move || run(&app, "list", |repo| repo.list_archives(offset))).await.map_err(|_| "archive_read_failed")?
}

#[tauri::command]
pub async fn read_memo_archive(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String) -> Result<Value, String> {
    caller(&window)?;
    tauri::async_runtime::spawn_blocking(move || run(&app, "read", |repo| repo.read_archive(&id))).await.map_err(|_| "archive_read_failed")?
}

#[tauri::command]
pub async fn delete_memo_archive(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String) -> Result<Value, String> {
    caller(&window)?;
    tauri::async_runtime::spawn_blocking(move || run(&app, "delete", |repo| repo.purge_archive(&id))).await.map_err(|_| "write_failed")?
}

#[tauri::command]
pub async fn export_memo_archive(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String) -> Result<Value, String> {
    caller(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let directory = app.path().download_dir().map_err(|_| "export_directory_unavailable")?;
        run(&app, "export", |repo| repo.export_and_remove(&id, &directory))
    }).await.map_err(|_| "export_write_failed")?
}

#[tauri::command]
pub fn close_memo_archive(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "archive" { return Err("archive_access_denied".into()); }
    window.hide().map_err(|_| "archive_close_failed")?;
    use tauri::Emitter;
    app.emit("memo-archive-visibility", false).map_err(|_| "archive_close_failed")?;
    Ok(())
}
