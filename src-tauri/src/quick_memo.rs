use std::{fs, io::Write, path::Path, sync::Mutex};
use tauri::{Emitter, Manager};

pub const MAX_MEMO_BYTES: usize = 1024 * 1024;
pub struct MemoStore(pub Mutex<()>);

fn read(path: &Path) -> Result<String, String> {
    match fs::metadata(path) {
        Ok(metadata) if !metadata.is_file() => return Err("메모 파일 위치에 다른 항목이 있습니다.".into()),
        Ok(_) => {},
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(error) => return Err(format!("메모를 읽지 못했습니다: {error}")),
    }
    fs::read_to_string(path).map_err(|error| format!("메모를 읽지 못했습니다: {error}"))
}

fn save(path: &Path, text: &str) -> Result<(), String> {
    if text.len() > MAX_MEMO_BYTES {
        return Err("메모는 UTF-8 기준 1 MiB까지 저장할 수 있습니다.".into());
    }
    let parent = path.parent().ok_or("메모 저장 폴더가 없습니다.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("tmp");
    let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    // Replacement happens only after the complete new contents reach disk.
    fs::rename(&temporary, path).map_err(|e| format!("메모 저장 실패: {e}"))
}

fn memo_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "memo" { return Err("메모창에서만 사용할 수 있습니다.".into()); }
    Ok(())
}

#[tauri::command]
pub fn read_quick_memo(window: tauri::WebviewWindow, store: tauri::State<MemoStore>) -> Result<String, String> {
    memo_window(&window)?;
    let _guard = store.0.lock().map_err(|e| e.to_string())?;
    let path = window.app_handle().path().app_local_data_dir().map_err(|e| e.to_string())?.join("quick-memo.txt");
    read(&path)
}

#[tauri::command]
pub async fn save_quick_memo(window: tauri::WebviewWindow, app: tauri::AppHandle, text: String) -> Result<(), String> {
    memo_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<MemoStore>();
        let _guard = store.0.lock().map_err(|e| e.to_string())?;
        let path = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("quick-memo.txt");
        save(&path, &text)
    }).await.map_err(|e| e.to_string())?
}

pub fn show(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("memo").ok_or("메모창을 찾을 수 없습니다.")?;
    // Recenter on invocation so a removed monitor cannot strand the memo.
    window.center().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window.emit("memo-focus", ()).map_err(|e| e.to_string())?;
    let _ = super::append_runtime_event(app, "quick_memo_opened", "{}");
    Ok(())
}

#[tauri::command]
pub fn open_quick_memo(app: tauri::AppHandle) -> Result<(), String> { show(&app) }

#[tauri::command]
pub fn hide_quick_memo(window: tauri::WebviewWindow) -> Result<(), String> {
    memo_window(&window)?;
    window.hide().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saves_unicode_replaces_and_preserves_previous_on_rejected_write() {
        let folder = std::env::temp_dir().join(format!("daybridge-memo-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let path = folder.join("quick-memo.txt");
        assert_eq!(read(&path).unwrap(), "");
        save(&path, "한글 메모\nsecond line 📝").unwrap();
        assert_eq!(read(&path).unwrap(), "한글 메모\nsecond line 📝");
        save(&path, "수정된 메모").unwrap();
        assert!(save(&path, &"a".repeat(MAX_MEMO_BYTES + 1)).is_err());
        assert_eq!(read(&path).unwrap(), "수정된 메모");
        assert!(!path.with_extension("tmp").exists());
        save(&path, "").unwrap();
        assert_eq!(read(&path).unwrap(), "");
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn unreadable_memo_is_not_treated_as_empty() {
        assert!(read(&std::env::temp_dir()).is_err());
    }
}
