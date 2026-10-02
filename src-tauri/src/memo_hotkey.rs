use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};

pub struct MemoHotkey {
    stop: Arc<AtomicBool>,
    status: Arc<Mutex<String>>,
    thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl MemoHotkey {
    pub fn start(app: tauri::AppHandle) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let status = Arc::new(Mutex::new("registering".to_string()));
        let signal = stop.clone();
        let result = status.clone();
        let thread = std::thread::spawn(move || run(app, signal, result));
        Self { stop, status, thread: Mutex::new(Some(thread)) }
    }
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Release);
        if let Ok(mut thread) = self.thread.lock() {
            if let Some(thread) = thread.take() { let _ = thread.join(); }
        }
    }
}
impl Drop for MemoHotkey { fn drop(&mut self) { self.stop(); } }

#[tauri::command]
pub fn memo_shortcut_status(state: tauri::State<MemoHotkey>) -> Result<String, String> {
    state.status.lock().map(|value| value.clone()).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn run(app: tauri::AppHandle, stop: Arc<AtomicBool>, status: Arc<Mutex<String>>) {
    use windows::Win32::UI::{Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, MOD_CONTROL, MOD_NOREPEAT, VK_D}, WindowsAndMessaging::{PeekMessageW, MSG, PM_REMOVE, WM_HOTKEY}};
    const ID: i32 = 0x4442;
    // A thread-owned hotkey avoids exchanging HWND values between crates.
    let registration = unsafe { RegisterHotKey(None, ID, MOD_CONTROL | MOD_NOREPEAT, u32::from(VK_D.0)) };
    if let Err(error) = registration {
        if let Ok(mut value) = status.lock() { *value = "unavailable".into(); }
        let _ = super::append_runtime_event(&app, "memo_shortcut_registration_failed", &serde_json::json!({"error": error.to_string()}).to_string());
        return;
    }
    if let Ok(mut value) = status.lock() { *value = "registered".into(); }
    let _ = super::append_runtime_event(&app, "memo_shortcut_registered", "{}");
    while !stop.load(Ordering::Acquire) {
        let mut message = MSG::default();
        while unsafe { PeekMessageW(&mut message, None, WM_HOTKEY, WM_HOTKEY, PM_REMOVE).as_bool() } {
            if message.wParam.0 == ID as usize {
                let target = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Err(error) = super::quick_memo::show(&target) {
                        let _ = super::append_runtime_event(&target, "quick_memo_open_failed", &serde_json::json!({"error": error}).to_string());
                    }
                });
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    let _ = unsafe { UnregisterHotKey(None, ID) };
}

#[cfg(not(windows))]
fn run(_app: tauri::AppHandle, _stop: Arc<AtomicBool>, status: Arc<Mutex<String>>) {
    if let Ok(mut value) = status.lock() { *value = "unsupported".into(); }
}
