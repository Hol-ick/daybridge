use serde_json::{json, Value};
use tauri::Manager;
use super::{memo_store::MemoRepository, quick_memo::{MemoStore, repository, log}};

fn caller(window: &tauri::WebviewWindow) -> Result<(), String> {
    if !matches!(window.label(), "overlay" | "dashboard") { return Err("archive_access_denied".into()); }
    Ok(())
}

fn run(app: &tauri::AppHandle, action: &str, operation: impl FnOnce(&MemoRepository) -> Result<Value, String>) -> Result<Value, String> {
    let store = app.state::<MemoStore>();
    let _gate = store.gate.lock().map_err(|_| "store_busy")?;
    let result = repository(app).and_then(|repo| operation(&repo));
    // Neither filenames, titles nor returned body content are diagnostic data.
    log(app, "memo_archive_action", json!({"action":action,"outcome":if result.is_ok(){"success"}else{"failed"}}));
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
    tauri::async_runtime::spawn_blocking(move || run(&app, "delete", |repo| repo.delete_archive(&id))).await.map_err(|_| "write_failed")?
}

#[tauri::command]
pub async fn restore_memo_archive(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String) -> Result<Value, String> {
    caller(&window)?;
    tauri::async_runtime::spawn_blocking(move || run(&app, "restore", |repo| repo.restore_archive(&id))).await.map_err(|_| "write_failed")?
}

fn save_destination(id: &str) -> Result<Option<std::path::PathBuf>, String> {
    #[cfg(windows)] {
        use windows::{core::{PCWSTR, PWSTR}, Win32::UI::Controls::Dialogs::*};
        let mut filename = vec![0u16; 32768];
        let proposed: Vec<_> = format!("{id}.txt").encode_utf16().collect();
        filename[..proposed.len()].copy_from_slice(&proposed);
        let filter: Vec<_> = "텍스트 (*.txt)\0*.txt\0\0".encode_utf16().collect();
        let extension: Vec<_> = "txt\0".encode_utf16().collect();
        let title: Vec<_> = "메모를 로컬에 저장\0".encode_utf16().collect();
        let mut dialog = OPENFILENAMEW { lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32, lpstrFile: PWSTR(filename.as_mut_ptr()), nMaxFile: filename.len() as u32, lpstrFilter: PCWSTR(filter.as_ptr()), lpstrDefExt: PCWSTR(extension.as_ptr()), lpstrTitle: PCWSTR(title.as_ptr()), Flags: OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST, ..Default::default() };
        if !unsafe { GetSaveFileNameW(&mut dialog) }.as_bool() {
            return if unsafe { CommDlgExtendedError() }.0 == 0 { Ok(None) } else { Err("export_dialog_failed".into()) };
        }
        let length = filename.iter().position(|c| *c == 0).ok_or("export_dialog_failed")?;
        use std::os::windows::ffi::OsStringExt;
        Ok(Some(std::ffi::OsString::from_wide(&filename[..length]).into()))
    }
    #[cfg(not(windows))] { let _ = id; Err("export_dialog_failed".into()) }
}

#[tauri::command]
pub async fn export_memo_archive(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String) -> Result<Value, String> {
    caller(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| -> Result<Value, String> {
        let memo = run(&app, "export_read", |repo| repo.read_archive(&id))?;
        let Some(path) = save_destination(&id)? else { return Ok(json!({"cancelled":true})); };
        let protected = app.path().app_local_data_dir().map_err(|_| "export_write_failed")?.canonicalize().map_err(|_| "export_write_failed")?;
        let parent = path.parent().ok_or("export_write_failed")?.canonicalize().map_err(|_| "export_write_failed")?;
        if parent.starts_with(protected) { return Err("export_protected_path".into()); }
        let text = memo["text"].as_str().ok_or("corrupt_archive")?;
        // A temporary sibling preserves the selected file if writing is interrupted.
        let temporary = path.with_file_name(format!(".daybridge-export-{}-{}.tmp", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
        use std::io::Write;
        let outcome = (|| -> std::io::Result<()> {
            let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
            file.write_all(text.as_bytes())?; file.sync_all()?; drop(file);
            std::fs::rename(&temporary, &path)
        })();
        if outcome.is_err() { let _ = std::fs::remove_file(&temporary); }
        outcome.map_err(|_| "export_write_failed")?;
        Ok(json!({"saved":true}))
        })();
        let outcome = match &result { Ok(value) if value["cancelled"] == true => "cancelled", Ok(_) => "success", Err(_) => "failed" };
        log(&app, "memo_archive_action", json!({"action":"export","outcome":outcome}));
        result
    }).await.map_err(|_| "export_write_failed")?
}
