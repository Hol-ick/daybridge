use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use super::memo_store::MemoRepository;

#[derive(Default)]
struct Lifecycle { active: bool, closed: Option<Value>, exit_reason: Option<String>, log_failures: u64 }
#[derive(Default)]
pub struct MemoStore { pub(super) gate: Mutex<()>, lifecycle: Mutex<Lifecycle> }

fn memo_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "memo" { return Err("메모창에서만 사용할 수 있습니다.".into()); }
    Ok(())
}

pub(super) fn repository(app: &tauri::AppHandle) -> Result<MemoRepository, String> {
    let root = app.path().app_local_data_dir().map_err(|_| "write_failed")?;
    MemoRepository::open(root.join("memos"))
}

fn event_details(id: Option<&str>, revision: u64, bytes: usize, duration_ms: u64, code: Option<&str>) -> Value {
    let safe_id = id.filter(|value| value.len() <= 128 && !value.is_empty() && value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-'));
    let mut details = json!({"id":safe_id,"revision":revision,"bytes":bytes,"durationMs":duration_ms,"outcome":if code.is_some() {"failed"} else {"success"}});
    if let Some(code) = code {
        details["code"] = json!(match code { "store_busy" | "write_failed" | "archive_conflict" | "stale_session" | "size_limit" | "corrupt_state" => code, _ => "write_failed" });
    }
    details
}

fn record_with_recovery(missing: &mut u64, event: &str, details: &Value, mut sink: impl FnMut(&str, &Value) -> bool) -> bool {
    let recovered = *missing == 0 || sink("memo_log_failed", &json!({"missingCount":*missing}));
    let healthy = sink(event, details);
    if recovered && healthy { *missing = 0; } else { *missing += 1; }
    healthy && recovered
}

// Only controlled metadata reaches the shared runtime log.
pub(super) fn log(app: &tauri::AppHandle, event: &str, details: Value) -> bool {
    let store = app.state::<MemoStore>();
    let Ok(mut life) = store.lifecycle.lock() else { return false; };
    record_with_recovery(&mut life.log_failures, event, &details, |name, value| super::append_runtime_event(app, name, &value.to_string()).is_ok())
}

fn operation(app: &tauri::AppHandle, kind: &str, id: Option<&str>, revision: u64, bytes: usize, action: impl FnOnce(&MemoRepository) -> Result<Value, String>) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let store = app.state::<MemoStore>();
    let _guard = store.gate.lock().map_err(|_| "store_busy")?;
    let result = repository(app).and_then(|repo| action(&repo));
    match result {
        Ok(mut ack) => {
            let event = if kind == "close" { if ack["archived"] == true { "memo_archived" } else { "memo_closed_empty" } } else { "memo_draft_saved" };
            let healthy = log(app, event, event_details(id, revision, bytes, started.elapsed().as_millis() as u64, None));
            ack["logHealthy"] = json!(healthy);
            Ok(ack)
        }
        Err(code) => {
            log(app, if kind == "close" { "memo_close_failed" } else { "memo_save_failed" }, event_details(id, revision, bytes, started.elapsed().as_millis() as u64, Some(&code)));
            Err(code)
        }
    }
}

#[tauri::command]
pub async fn begin_memo_session(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Value, String> {
    memo_window(&window)?;
    let worker_app = app.clone();
    let session = tauri::async_runtime::spawn_blocking(move || {
        let store = worker_app.state::<MemoStore>();
        let _guard = store.gate.lock().map_err(|_| "store_busy")?;
        let repo = repository(&worker_app)?;
        let legacy = worker_app.path().app_local_data_dir().map_err(|_| "write_failed")?.join("quick-memo.txt");
        if repo.import_legacy_once(&legacy)? { log(&worker_app, "memo_legacy_imported", json!({"outcome":"success"})); }
        let mut session = repo.begin()?;
        let healthy = log(&worker_app, if session["recovered"] == true { "memo_draft_recovered" } else { "memo_session_opened" }, json!({"id":session["draft"]["id"],"revision":session["draft"]["revision"],"outcome":"success"}));
        session["logHealthy"] = json!(healthy);
        let mut life = store.lifecycle.lock().map_err(|_| "store_busy")?;
        life.active = true; life.closed = None;
        Ok::<Value, String>(session)
    }).await.map_err(|_| "write_failed")?;
    let session = match session {
        Ok(session) => session,
        Err(code) => { log(&app, "memo_save_failed", event_details(None, 0, 0, 0, Some(&code))); return Err(code); }
    };
    window.show().map_err(|_| "window_failed")?;
    window.set_focus().map_err(|_| "window_failed")?;
    Ok(session)
}

#[tauri::command]
pub async fn save_memo_draft(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String, revision: u64, text: String) -> Result<Value, String> {
    memo_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || operation(&app, "save", Some(&id), revision, text.len(), |repo| repo.save(&id, revision, &text))).await.map_err(|_| "write_failed")?
}

#[tauri::command]
pub async fn finalize_memo_session(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String, revision: u64, text: String) -> Result<Value, String> {
    memo_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = operation(&app, "close", Some(&id), revision, text.len(), |repo| repo.finish(&id, revision, &text))?;
        app.state::<MemoStore>().lifecycle.lock().map_err(|_| "store_busy")?.closed = Some(result.clone());
        Ok(result)
    }).await.map_err(|_| "write_failed")?
}

pub fn show(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("memo").ok_or("window_failed")?;
    if !window.is_visible().map_err(|_| "window_failed")? { window.center().map_err(|_| "window_failed")?; }
    window.unminimize().map_err(|_| "window_failed")?;
    window.show().map_err(|_| "window_failed")?;
    window.set_focus().map_err(|_| "window_failed")?;
    window.emit("memo-focus", ()).map_err(|_| "window_failed".into())
}

#[tauri::command]
pub fn open_quick_memo(app: tauri::AppHandle) -> Result<(), String> { show(&app) }

#[tauri::command]
pub fn hide_quick_memo(window: tauri::WebviewWindow, store: tauri::State<MemoStore>) -> Result<(), String> {
    memo_window(&window)?;
    let mut life = store.lifecycle.lock().map_err(|_| "store_busy")?;
    if life.closed.is_none() { return Err("close_not_finalized".into()); }
    window.hide().map_err(|_| "window_failed")?;
    life.active = false;
    Ok(())
}

pub fn open_archive(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("archive").ok_or("archive_open_failed")?;
    if !window.is_visible().unwrap_or(false) {
        if let Ok(Some(monitor)) = window.current_monitor() {
            if let Ok(size) = window.outer_size() {
                let area = monitor.work_area();
                let gap = (304.0 * monitor.scale_factor()) as i32;
                let x = (area.position.x + area.size.width as i32 - gap - size.width as i32).max(area.position.x);
                let y = area.position.y + (area.size.height.saturating_sub(size.height) / 2) as i32;
                let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
            }
        }
    }
    window.emit("memo-archive-open", ()).map_err(|_| "archive_open_failed")?;
    app.emit("memo-archive-visibility", true).map_err(|_| "archive_open_failed")?;
    window.show().map_err(|_| "archive_open_failed")?;
    window.set_focus().map_err(|_| "archive_open_failed")?;
    Ok(())
}

#[tauri::command]
pub fn open_memo_archive_directory(app: tauri::AppHandle) -> Result<(), String> { open_archive(&app) }

pub fn request_exit(app: &tauri::AppHandle, reason: &str) {
    let store = app.state::<MemoStore>();
    let active = store.lifecycle.lock().map(|life| life.active).unwrap_or(true);
    if active {
        if let Ok(mut life) = store.lifecycle.lock() { life.exit_reason = Some(reason.to_string()); }
        if let Some(window) = app.get_webview_window("memo") {
            let _ = window.emit("memo-close-request", json!({"exit":true}));
            let _ = window.show(); let _ = window.set_focus();
        }
        // No renderer ACK means no exit; the saved draft remains intact.
    } else { super::request_explicit_exit(app, reason); app.exit(0); }
}

#[tauri::command]
pub fn complete_memo_exit(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    memo_window(&window)?;
    let store = app.state::<MemoStore>();
    let mut life = store.lifecycle.lock().map_err(|_| "store_busy")?;
    if life.active || life.closed.is_none() { return Err("close_not_finalized".into()); }
    if let Some(reason) = life.exit_reason.take() { super::request_explicit_exit(&app, &reason); app.exit(0); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostics_exclude_untrusted_ids_and_raw_errors() {
        let details = event_details(Some("개인 메모 본문 C:\\private"), 4, 20, 3, Some("permission denied C:\\private"));
        let output = details.to_string();
        assert!(details["id"].is_null()); assert_eq!(details["code"], "write_failed");
        assert!(!output.contains("private")); assert!(!output.contains("메모 본문"));
        assert_eq!(event_details(Some("m-123-4-5"), 1, 5, 3, None)["id"], "m-123-4-5");
    }
    #[test]
    fn log_failure_is_nonrecursive_and_missing_count_resets_after_recovery() {
        let mut missing = 0; let details = event_details(Some("m-1"), 1, 9, 0, None); let mut events = Vec::new();
        assert!(!record_with_recovery(&mut missing, "memo_archived", &details, |event, _| { events.push(event.to_string()); false }));
        assert_eq!(events, ["memo_archived"]); assert_eq!(missing, 1);
        events.clear();
        assert!(record_with_recovery(&mut missing, "memo_session_opened", &details, |event, _| { events.push(event.to_string()); true }));
        assert_eq!(events, ["memo_log_failed", "memo_session_opened"]); assert_eq!(missing, 0);
    }
}
