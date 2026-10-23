use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, AtomicU8, Ordering},
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

static PREPARING: AtomicBool = AtomicBool::new(false);
static SURFACES: AtomicU8 = AtomicU8::new(0);
const IDLE_SECONDS: u64 = 120;
const CHECK_SECONDS: u64 = 4 * 60 * 60;
pub fn preparing() -> bool {
    PREPARING.load(Ordering::Acquire)
}
fn log(app: &tauri::AppHandle, event: &str, details: Value) {
    let _ = super::append_runtime_event(app, event, &details.to_string());
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn read_json(path: &Path) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|_| "state_read_failed")?;
    // Windows PowerShell writes a UTF-8 BOM.
    serde_json::from_slice(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes))
        .map_err(|_| "state_invalid".into())
}
pub fn memo_idle(path: &Path) -> bool {
    if !path.exists() {
        return true;
    }
    read_json(path).is_ok_and(|v| {
        v["schemaVersion"] == 1 && v["active"].is_null() && v["pendingArchive"].is_null()
    })
}
pub fn eligible(
    idle_seconds: u64,
    memo_busy: bool,
    window_open: bool,
    settings_open: bool,
) -> bool {
    idle_seconds >= IDLE_SECONDS && !memo_busy && !window_open && !settings_open
}
fn trusted_download(version: &str, url: &str) -> bool {
    let parts: Vec<_> = version.split('.').collect();
    parts.len()==3 && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|c| c.is_ascii_digit()))
        && url==format!("https://github.com/Hol-ick/daybridge/releases/download/v{version}/Daybridge_{version}_x64-setup.exe")
}
#[cfg(windows)]
fn idle_seconds() -> Option<u64> {
    use windows::Win32::{
        System::SystemInformation::GetTickCount64,
        UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
    };
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetLastInputInfo(&mut info).as_bool() } {
        return None;
    }
    Some((unsafe { GetTickCount64() } as u32).wrapping_sub(info.dwTime) as u64 / 1000)
}
#[cfg(not(windows))]
fn idle_seconds() -> Option<u64> {
    None
}
fn can_apply(app: &tauri::AppHandle) -> bool {
    let Some(idle) = idle_seconds() else {
        return false;
    };
    let busy = super::quick_memo::has_active_session(app)
        || app
            .path()
            .app_local_data_dir()
            .map(|p| !memo_idle(&p.join("memos/state.json")))
            .unwrap_or(true);
    let open = super::OVERLAY_EXPANDED.load(Ordering::Acquire) || ["archive", "dashboard"].iter().any(|label| {
        app.get_webview_window(label)
            .map(|w| w.is_visible().unwrap_or(true))
            .unwrap_or(true)
    });
    eligible(
        idle,
        busy,
        open,
        super::SETTINGS_MODAL_OPEN.load(Ordering::Acquire),
    )
}

pub fn surface_ready(app: &tauri::AppHandle, surface: &str) {
    let bit = match surface {
        "overlay" => 1,
        "archive" => 2,
        "dashboard" => 4,
        _ => return,
    };
    let bits = SURFACES.fetch_or(bit, Ordering::AcqRel) | bit;
    if bits != 7 || !super::bridge_is_reachable() {
        return;
    }
    let Some(path) = std::env::var_os("DAYBRIDGE_UPDATE_PLAN").map(PathBuf::from) else {
        return;
    };
    let Ok(cache) = app.path().app_local_data_dir().map(|p| p.join("updates")) else {
        return;
    };
    let Some(root) = path.parent() else {
        return;
    };
    if root.parent() != Some(cache.as_path())
        || path.file_name().and_then(|n| n.to_str()) != Some("plan.json")
    {
        return;
    }
    let Ok(plan) = read_json(&path) else {
        return;
    };
    if plan["version"] != env!("CARGO_PKG_VERSION")
        || plan["token"].as_str().is_none_or(|t| t.len() < 10)
    {
        return;
    }
    let ack = json!({"version":env!("CARGO_PKG_VERSION"),"token":plan["token"],"pid":std::process::id(),"revision":env!("DAYBRIDGE_BUILD_REVISION")});
    let temp = root.join("ready.tmp");
    if fs::write(&temp, ack.to_string())
        .and_then(|_| fs::rename(&temp, root.join("ready.json")))
        .is_ok()
    {
        log(
            app,
            "app_update_startup_verified",
            json!({"version":env!("CARGO_PKG_VERSION")}),
        );
    }
}

#[cfg(windows)]
fn start_ticks() -> Result<String, String> {
    use windows::Win32::{
        Foundation::FILETIME,
        System::Threading::{GetCurrentProcess, GetProcessTimes},
    };
    let (mut creation, mut exit, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    }
    .map_err(|_| "process_identity_failed")?;
    Ok(
        (((creation.dwHighDateTime as u64) << 32 | creation.dwLowDateTime as u64)
            + 504911232000000000)
            .to_string(),
    )
}
#[cfg(not(windows))]
fn start_ticks() -> Result<String, String> {
    Err("unsupported_platform".into())
}

fn handoff(
    app: &tauri::AppHandle,
    root: &Path,
    version: &str,
    signature: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|_| "executable_unavailable")?;
    let install = exe.parent().ok_or("installation_unavailable")?;
    let local = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "data_unavailable")?;
    let pointer = local
        .parent()
        .ok_or("data_unavailable")?
        .join("Daybridge/storage-location.json");
    let pointer_bytes = fs::read(&pointer).map_err(|_| "pointer_unavailable")?;
    let pointer_json: Value =
        serde_json::from_slice(&pointer_bytes).map_err(|_| "pointer_invalid")?;
    let data_dir = pointer_json["dataDirectory"]
        .as_str()
        .ok_or("pointer_invalid")?;
    let marker = super::app_data_file(app, super::EXPLICIT_EXIT_MARKER_FILE)?;
    let stamp = super::SystemTime::now()
        .duration_since(super::UNIX_EPOCH)
        .map_err(|_| "clock_failed")?
        .as_millis();
    let plan = json!({"version":version,"signature":signature,"token":format!("{stamp}-{}",std::process::id()),"install":install,
        "installer":root.join("update.exe"),"installerHash":sha(bytes),"oldHash":sha(&fs::read(&exe).map_err(|_|"executable_read_failed")?),
        "oldPid":std::process::id(),"oldStartTicks":start_ticks()?,"pointer":pointer,"pointerHash":sha(&pointer_bytes),"dataDir":data_dir,
        "memoState":local.join("memos/state.json"),"marker":marker});
    fs::write(root.join("update.exe"), bytes).map_err(|_| "package_write_failed")?;
    fs::write(root.join("plan.json"), plan.to_string()).map_err(|_| "plan_write_failed")?;
    fs::copy(&exe, root.join("guard.exe")).map_err(|_| "guard_write_failed")?;
    let mut command = Command::new(root.join("guard.exe"));
    command
        .arg("--apply-update")
        .arg(root.join("plan.json"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut guard = command.spawn().map_err(|_| "guard_start_failed")?;
    for _ in 0..600 {
        if root.join("prepared").exists() {
            break;
        }
        if guard.try_wait().map_err(|_| "guard_wait_failed")?.is_some() {
            return Err("guard_preparation_failed".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    if !root.join("prepared").exists() {
        let _ = fs::write(root.join("abort"), "timeout");
        return Err("guard_preparation_timeout".into());
    }
    let store = app.state::<super::quick_memo::MemoStore>();
    let _gate = store.gate.lock().map_err(|_| "memo_busy")?;
    if !can_apply(app) {
        let _ = fs::write(root.join("abort"), "in_use");
        return Err("application_in_use".into());
    }
    PREPARING.store(true, Ordering::Release);
    let marked = fs::write(&marker, "automatic_update");
    if marked.is_err() {
        PREPARING.store(false, Ordering::Release);
        let _ = fs::write(root.join("abort"), "marker");
        return Err("exit_marker_failed".into());
    }
    // The existing process watchdog must observe an intentional exit first.
    std::thread::sleep(Duration::from_secs(4));
    if !can_apply(app) {
        let _ = fs::write(root.join("abort"), "in_use");
        let _ = fs::remove_file(marker);
        PREPARING.store(false, Ordering::Release);
        let _ = super::start_process_keep_alive(app);
        return Err("application_in_use".into());
    }
    log(app, "app_update_handoff", json!({"version":version}));
    app.exit(0);
    Ok(())
}

async fn check(app: &tauri::AppHandle) -> Result<(), String> {
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| "updater_configuration_failed")?;
    let Some(update) = updater.check().await.map_err(|_| "update_check_failed")? else {
        log(
            app,
            "app_update_current",
            json!({"version":env!("CARGO_PKG_VERSION")}),
        );
        return Ok(());
    };
    if !trusted_download(&update.version, update.download_url.as_str()) {
        return Err("untrusted_update_url".into());
    }
    let cache = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "data_unavailable")?
        .join("updates");
    let failed = cache.join("failed-version.json");
    if failed.exists() && read_json(&failed)?["version"] == update.version {
        log(
            app,
            "app_update_quarantined",
            json!({"version":update.version}),
        );
        return Ok(());
    }
    log(
        app,
        "app_update_available",
        json!({"version":update.version}),
    );
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|_| "update_download_or_signature_failed")?;
    log(
        app,
        "app_update_signature_verified",
        json!({"version":update.version,"bytes":bytes.len()}),
    );
    // A download never closes an editor. Applying waits until the user is idle.
    while !can_apply(app) {
        std::thread::sleep(Duration::from_secs(30));
    }
    let stamp = super::SystemTime::now()
        .duration_since(super::UNIX_EPOCH)
        .map_err(|_| "clock_failed")?
        .as_millis();
    let root = cache.join(format!("update-{stamp}"));
    fs::create_dir_all(&root).map_err(|_| "cache_create_failed")?;
    handoff(app, &root, &update.version, &update.signature, &bytes)
}

pub fn start(app: tauri::AppHandle) {
    if cfg!(debug_assertions) || !cfg!(windows) {
        return;
    }
    log(
        &app,
        "app_updater_started",
        json!({"version":env!("CARGO_PKG_VERSION"),"checkIntervalSeconds":CHECK_SECONDS,"idleSeconds":IDLE_SECONDS}),
    );
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(60));
        loop {
            if let Err(code) = tauri::async_runtime::block_on(check(&app)) {
                log(&app, "app_update_error", json!({"code":code}));
            }
            std::thread::sleep(Duration::from_secs(CHECK_SECONDS));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn updates_wait_for_input_and_every_editor_to_finish() {
        assert!(eligible(120, false, false, false));
        assert!(!eligible(119, false, false, false));
        for (memo, window, settings) in [
            (true, false, false),
            (false, true, false),
            (false, false, true),
        ] {
            assert!(!eligible(1000, memo, window, settings));
        }
    }
    #[test]
    fn download_must_be_the_exact_versioned_repository_asset() {
        assert!(trusted_download("0.2.1","https://github.com/Hol-ick/daybridge/releases/download/v0.2.1/Daybridge_0.2.1_x64-setup.exe"));
        for url in ["http://github.com/Hol-ick/daybridge/releases/download/v0.2.1/Daybridge_0.2.1_x64-setup.exe",
            "https://example.com/update.exe","https://github.com/Hol-ick/daybridge/releases/download/v0.2.0/Daybridge_0.2.0_x64-setup.exe"] {
            assert!(!trusted_download("0.2.1",url));
        }
    }
    #[test]
    fn interrupted_or_corrupt_drafts_block_installation() {
        let root =
            std::env::temp_dir().join(format!("daybridge-updater-state-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("state.json");
        for value in [
            json!({"schemaVersion":1,"active":{},"pendingArchive":null}),
            json!({"schemaVersion":1,"active":null,"pendingArchive":{}}),
            json!({}),
        ] {
            fs::write(&path, value.to_string()).unwrap();
            assert!(!memo_idle(&path));
        }
        fs::write(&path, b"corrupt").unwrap();
        assert!(!memo_idle(&path));
        fs::write(
            &path,
            b"{\"schemaVersion\":1,\"active\":null,\"pendingArchive\":null}",
        )
        .unwrap();
        assert!(memo_idle(&path));
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
