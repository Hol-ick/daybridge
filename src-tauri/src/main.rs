#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::json;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition, Position, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

const OVERLAY_POSITION_FILE: &str = "overlay-position.json";
const RUNTIME_LOG_FILE: &str = "runtime-events.ndjson";
const WINDOWS_STARTUP_VALUE: &str = "Daybridge";
const LOCAL_BRIDGE_PORT: u16 = 39393;
const LOCAL_BRIDGE_SCRIPT: &str = "scripts/local-bridge.mjs";
const KEEP_ALIVE_SCRIPT_FILE: &str = "daybridge-keep-alive.ps1";
const EXPLICIT_EXIT_MARKER_FILE: &str = "explicit-exit.flag";

#[cfg(windows)]
fn configure_windows_startup() -> Result<(), String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let executable = std::env::current_exe()
        .map_err(|error| format!("실행 파일 경로를 확인할 수 없습니다: {error}"))?;
    let quoted_executable = format!("\"{}\"", executable.display());
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = current_user
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
        .map_err(|error| format!("Windows 시작 항목을 열 수 없습니다: {error}"))?;
    run_key
        .set_value(WINDOWS_STARTUP_VALUE, &quoted_executable)
        .map_err(|error| format!("Windows 시작 항목을 저장할 수 없습니다: {error}"))
}

fn app_data_file(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Daybridge 앱 데이터 경로를 확인할 수 없습니다: {error}"))
        .map(|directory| directory.join(file_name))
}

fn keep_alive_script(
    executable: &std::path::Path,
    exit_marker: &std::path::Path,
    event_log: &std::path::Path,
) -> String {
    let quote = |path: &std::path::Path| path.display().to_string().replace('\'', "''");
    let executable = quote(executable);
    let working_directory = quote(&executable_parent_or_empty(&executable));
    let exit_marker = quote(exit_marker);
    let event_log = quote(event_log);

    format!(
        r#"$ErrorActionPreference = 'SilentlyContinue'
$ExecutablePath = '{executable}'
$WorkingDirectory = '{working_directory}'
$ExitMarkerPath = '{exit_marker}'
$EventLogPath = '{event_log}'
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\DaybridgeWidgetKeepAlive', [ref]$createdNew)

function Write-DaybridgeEvent([string]$Event, [hashtable]$Details = @{{}}) {{
  try {{
    $directory = Split-Path -Parent $EventLogPath
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    [ordered]@{{
      occurredAt = (Get-Date).ToUniversalTime().ToString('o')
      event = $Event
      source = 'keep_alive'
      details = $Details
    }} | ConvertTo-Json -Compress | Add-Content -LiteralPath $EventLogPath -Encoding utf8
  }} catch {{}}
}}

try {{
  if (-not $createdNew) {{ exit 0 }}
  Write-DaybridgeEvent 'process_watchdog_started' @{{ executable = $ExecutablePath; intervalSeconds = 3 }}
  while ($true) {{
    if (Test-Path -LiteralPath $ExitMarkerPath) {{
      Write-DaybridgeEvent 'process_watchdog_stopped' @{{ reason = 'explicit_exit' }}
      break
    }}
    try {{
      $running = @(Get-CimInstance Win32_Process -Filter "Name='daybridge.exe'" |
        Where-Object {{ $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $ExecutablePath, [System.StringComparison]::OrdinalIgnoreCase) }}).Count -gt 0
    }} catch {{
      Write-DaybridgeEvent 'process_watchdog_query_error' @{{ error = $_.Exception.Message }}
      Start-Sleep -Seconds 3
      continue
    }}
    if (-not $running) {{
      Write-DaybridgeEvent 'process_relaunch_requested' @{{ reason = 'widget_process_missing' }}
      try {{
        Start-Process -FilePath $ExecutablePath -WorkingDirectory $WorkingDirectory -WindowStyle Hidden
      }} catch {{
        Write-DaybridgeEvent 'process_relaunch_error' @{{ error = $_.Exception.Message }}
      }}
    }}
    Start-Sleep -Seconds 3
  }}
}} finally {{
  if ($createdNew) {{ $mutex.ReleaseMutex() }}
  $mutex.Dispose()
}}
"#
    )
}

fn executable_parent_or_empty(executable: &str) -> PathBuf {
    PathBuf::from(executable)
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default()
}

#[cfg(windows)]
fn start_process_keep_alive(app: &tauri::AppHandle) -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("실행 파일 경로를 확인할 수 없습니다: {error}"))?;
    let script_path = app_data_file(app, KEEP_ALIVE_SCRIPT_FILE)?;
    let exit_marker = app_data_file(app, EXPLICIT_EXIT_MARKER_FILE)?;
    let event_log = runtime_log_path(app)
        .ok_or_else(|| "위젯 런타임 로그 경로를 확인할 수 없습니다.".to_string())?;

    if let Some(parent) = script_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("프로세스 감시자 경로를 만들 수 없습니다: {error}"))?;
    }
    std::fs::write(&script_path, keep_alive_script(&executable, &exit_marker, &event_log))
        .map_err(|error| format!("프로세스 감시자 스크립트를 저장할 수 없습니다: {error}"))?;

    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
    let child = command
        .spawn()
        .map_err(|error| format!("프로세스 감시자를 시작할 수 없습니다: {error}"))?;
    append_runtime_event(
        app,
        "process_watchdog_spawned",
        &json!({ "pid": child.id(), "intervalSeconds": 3 }).to_string(),
    )
}

#[cfg(not(windows))]
fn start_process_keep_alive(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

fn clear_explicit_exit_marker(app: &tauri::AppHandle) {
    if let Ok(marker) = app_data_file(app, EXPLICIT_EXIT_MARKER_FILE) {
        if marker.exists() {
            if let Err(error) = std::fs::remove_file(&marker) {
                let _ = append_runtime_event(
                    app,
                    "explicit_exit_marker_clear_error",
                    &json!({ "error": error.to_string() }).to_string(),
                );
            }
        }
    }
}

fn request_explicit_exit(app: &tauri::AppHandle, reason: &str) {
    match app_data_file(app, EXPLICIT_EXIT_MARKER_FILE) {
        Ok(marker) => {
            if let Some(parent) = marker.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(error) = std::fs::write(&marker, reason) {
                let _ = append_runtime_event(
                    app,
                    "explicit_exit_marker_write_error",
                    &json!({ "error": error.to_string(), "reason": reason }).to_string(),
                );
            }
        }
        Err(error) => {
            let _ = append_runtime_event(
                app,
                "explicit_exit_marker_path_error",
                &json!({ "error": error, "reason": reason }).to_string(),
            );
        }
    }
}

fn bridge_endpoint() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], LOCAL_BRIDGE_PORT))
}

fn bridge_is_reachable() -> bool {
    TcpStream::connect_timeout(&bridge_endpoint(), Duration::from_millis(200)).is_ok()
}

fn bridge_project_root() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    // Packaged local builds live at <project>/src-tauri/target/<profile>/daybridge.exe.
    // Walking up four parents also keeps this working for target/debug builds.
    executable
        .parent()?
        .parent()?
        .parent()?
        .parent()
        .map(PathBuf::from)
}

fn start_local_bridge(app: &tauri::AppHandle) -> Result<(), String> {
    if bridge_is_reachable() {
        let _ = append_runtime_event(
            app,
            "bridge_autostart_already_running",
            &json!({ "port": LOCAL_BRIDGE_PORT }).to_string(),
        );
        return Ok(());
    }

    let project_root = bridge_project_root()
        .ok_or_else(|| "Daybridge 프로젝트 경로를 확인할 수 없습니다.".to_string())?;
    let script = project_root.join(LOCAL_BRIDGE_SCRIPT);
    if !script.is_file() {
        let error = format!(
            "로컬 브리지 스크립트를 찾을 수 없습니다: {}",
            script.display()
        );
        let _ = append_runtime_event(
            app,
            "bridge_autostart_unavailable",
            &json!({ "error": error }).to_string(),
        );
        return Err(error);
    }

    let node = std::env::var_os("DAYBRIDGE_NODE").unwrap_or_else(|| "node".into());
    let mut command = Command::new(&node);
    command
        .arg(&script)
        .current_dir(&project_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW keeps the background bridge from flashing a console at login.
        command.creation_flags(0x08000000);
    }
    let child = command.spawn().map_err(|error| {
        let message = format!("로컬 브리지를 시작할 수 없습니다: {error}");
        let _ = append_runtime_event(
            app,
            "bridge_autostart_error",
            &json!({ "error": message }).to_string(),
        );
        message
    })?;
    let _ = append_runtime_event(
        app,
        "bridge_autostart_spawned",
        &json!({ "port": LOCAL_BRIDGE_PORT, "pid": child.id() }).to_string(),
    );

    // Give Node a short head start so the first WebView request does not race
    // the HTTP listener. A later poll still recovers if startup is slower.
    for _ in 0..20 {
        if bridge_is_reachable() {
            let _ = append_runtime_event(
                app,
                "bridge_autostart_ready",
                &json!({ "port": LOCAL_BRIDGE_PORT }).to_string(),
            );
            return Ok(());
        }
        thread::sleep(Duration::from_millis(50));
    }

    let error = format!("로컬 브리지가 {LOCAL_BRIDGE_PORT} 포트에서 준비되지 않았습니다.");
    let _ = append_runtime_event(
        app,
        "bridge_autostart_timeout",
        &json!({ "error": error, "port": LOCAL_BRIDGE_PORT }).to_string(),
    );
    Err(error)
}

#[cfg(not(windows))]
fn configure_windows_startup() -> Result<(), String> {
    Ok(())
}

fn overlay_position_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join(OVERLAY_POSITION_FILE))
}

fn parse_position_value(contents: &str, key: &str) -> Option<i32> {
    let marker = format!("\"{key}\":");
    let value = contents
        .split_once(&marker)?
        .1
        .split([',', '}'])
        .next()?
        .trim();
    value.parse().ok()
}

fn read_overlay_position(app: &tauri::AppHandle) -> Option<[i32; 2]> {
    let path = overlay_position_path(app)?;
    let contents = std::fs::read_to_string(path).ok()?;
    Some([
        parse_position_value(&contents, "x")?,
        parse_position_value(&contents, "y")?,
    ])
}

fn persist_overlay_position(app: &tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    let path = overlay_position_path(app)
        .ok_or_else(|| "앱 데이터 경로를 확인할 수 없습니다.".to_string())?;
    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, format!("{{\"x\":{x},\"y\":{y}}}\n")).map_err(|error| error.to_string())
}

fn runtime_log_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join("logs").join(RUNTIME_LOG_FILE))
}

fn append_runtime_event(app: &tauri::AppHandle, event: &str, details: &str) -> Result<(), String> {
    let path =
        runtime_log_path(app).ok_or_else(|| "앱 로그 경로를 확인할 수 없습니다.".to_string())?;
    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    let details_value = serde_json::from_str::<serde_json::Value>(details)
        .unwrap_or_else(|_| serde_json::Value::String(details.chars().take(4_000).collect()));
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let record = json!({
        "schemaVersion": 1,
        "source": "native",
        "event": event.chars().take(80).collect::<String>(),
        "occurredAtUnixMs": timestamp,
        "details": details_value,
    });
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{record}").map_err(|error| error.to_string())
}

fn position_is_outside_work_area(
    position: (i32, i32),
    size: (u32, u32),
    work_area_position: (i32, i32),
    work_area_size: (u32, u32),
) -> bool {
    let (left, top) = (
        i64::from(work_area_position.0),
        i64::from(work_area_position.1),
    );
    let right = left + i64::from(work_area_size.0);
    let bottom = top + i64::from(work_area_size.1);
    let (window_left, window_top) = (i64::from(position.0), i64::from(position.1));
    let window_right = window_left + i64::from(size.0);
    let window_bottom = window_top + i64::from(size.1);

    window_right <= left || window_left >= right || window_bottom <= top || window_top >= bottom
}

/// Restore only a fully off-screen overlay. A deliberately central position is
/// kept intact; this recovery is for display, DPI, and taskbar-layout changes
/// that leave the persistent process running with no reachable widget.
fn restore_overlay_if_off_screen(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
) -> Result<bool, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(app.primary_monitor().map_err(|error| error.to_string())?);
    let Some(monitor) = monitor else {
        return Ok(false);
    };
    let work_area = monitor.work_area();
    if !position_is_outside_work_area(
        (position.x, position.y),
        (size.width, size.height),
        (work_area.position.x, work_area.position.y),
        (work_area.size.width, work_area.size.height),
    ) {
        return Ok(false);
    }

    let next_x = work_area.position.x
        + i32::try_from(work_area.size.width.saturating_sub(size.width)).unwrap_or(i32::MAX);
    let next_y = work_area.position.y
        + i32::try_from(work_area.size.height.saturating_sub(size.height)).unwrap_or(i32::MAX);
    window
        .set_position(Position::Physical(PhysicalPosition::new(next_x, next_y)))
        .map_err(|error| error.to_string())?;
    let _ = persist_overlay_position(app, next_x, next_y);
    Ok(true)
}

#[cfg(windows)]
fn force_native_overlay_visible(window: &WebviewWindow) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
    };

    let handle = window.hwnd().map_err(|error| error.to_string())?;
    // Tauri's visibility state can stay true while a transparent WebView is
    // hidden by Windows. Repeating the framework-level `show` alone then has
    // no observable effect. Explicit Win32 calls restore both the visible bit
    // and the topmost z-order without taking keyboard focus.
    unsafe {
        let _ = ShowWindow(handle, SW_SHOWNOACTIVATE);
        SetWindowPos(
            handle,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn force_native_overlay_visible(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

fn ensure_overlay_visible(app: &tauri::AppHandle, source: &str) -> Result<bool, String> {
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "오버레이 창을 찾을 수 없습니다.".to_string())?;
    let was_visible = window.is_visible().unwrap_or(false);
    let was_minimized = window.is_minimized().unwrap_or(false);
    window.unminimize().map_err(|error| error.to_string())?;
    // A transparent window can remain visible but lose its place in the
    // topmost z-order after a display/full-screen transition. Re-assert the
    // native flag whenever the tray or the visibility watchdog asks for a
    // recovery, without stealing focus from the user's current application.
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    force_native_overlay_visible(&window)?;
    let repositioned = restore_overlay_if_off_screen(app, &window)?;
    if !was_visible || was_minimized || repositioned {
        let _ = append_runtime_event(
            app,
            "overlay_visibility_recovered",
            &json!({
                "source": source,
                "previouslyVisible": was_visible,
                "previouslyMinimized": was_minimized,
                "repositionedFromOffScreen": repositioned,
            })
            .to_string(),
        );
    }
    Ok(!was_visible || was_minimized || repositioned)
}

/// Keep the recovery independent from the transparent WebView's JavaScript
/// lifecycle. When Windows covers, hides, or relocates that WebView, browser
/// timers may be suspended even though the native process is still alive.
fn start_overlay_visibility_watchdog(app: tauri::AppHandle) {
    let _ = append_runtime_event(
        &app,
        "overlay_watchdog_started",
        &json!({ "intervalSeconds": 3 }).to_string(),
    );
    thread::spawn(move || {
        let mut consecutive_failures = 0_u32;
        loop {
            thread::sleep(Duration::from_secs(3));
            match ensure_overlay_visible(&app, "native_watchdog") {
                Ok(_) => consecutive_failures = 0,
                Err(error) => {
                    consecutive_failures = consecutive_failures.saturating_add(1);
                    // Preserve the first error and periodic repeats without
                    // turning a long-running recovery into log noise.
                    if consecutive_failures == 1 || consecutive_failures % 20 == 0 {
                        let _ = append_runtime_event(
                            &app,
                            "overlay_watchdog_error",
                            &json!({
                                "consecutiveFailures": consecutive_failures,
                                "error": error,
                            })
                            .to_string(),
                        );
                    }
                }
            }
        }
    });
}

fn dashboard_window(app: &tauri::AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window("dashboard") {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        "dashboard",
        WebviewUrl::App("index.html?surface=dashboard".into()),
    )
    .title("Daybridge 관리")
    .inner_size(960.0, 760.0)
    .min_inner_size(660.0, 540.0)
    .resizable(true)
    .visible(false)
    .background_color(tauri::window::Color(37, 37, 49, 255))
    .build()
}

fn show_dashboard(app: &tauri::AppHandle) -> tauri::Result<()> {
    let _ = ensure_overlay_visible(app, "dashboard_open");
    let window = dashboard_window(app)?;
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

#[tauri::command]
fn show_overlay(app: tauri::AppHandle) -> Result<bool, String> {
    ensure_overlay_visible(&app, "command")
}

#[tauri::command]
fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    show_dashboard(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_overlay_position(app: tauri::AppHandle) -> Option<[i32; 2]> {
    read_overlay_position(&app)
}

#[tauri::command]
fn save_overlay_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    persist_overlay_position(&app, x, y)
}

#[tauri::command]
fn record_runtime_event(
    app: tauri::AppHandle,
    event: String,
    details: String,
) -> Result<(), String> {
    append_runtime_event(&app, &event, &details)
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle, reason: Option<String>) {
    let reason = reason.unwrap_or_else(|| "unspecified".to_string());
    request_explicit_exit(&app, &reason);
    let details = json!({ "reason": reason }).to_string();
    let _ = append_runtime_event(&app, "app_exit_requested", &details);
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            clear_explicit_exit_marker(app.handle());
            let _ = append_runtime_event(
                app.handle(),
                "app_started",
                &json!({ "debug": cfg!(debug_assertions) }).to_string(),
            );
            // Only the packaged application registers itself. Development
            // builds depend on the local Vite server and must not become a
            // stale Windows startup entry after a reboot.
            if !cfg!(debug_assertions) {
                if let Err(error) = configure_windows_startup() {
                    eprintln!("Daybridge 자동 시작 등록 실패: {error}");
                    let _ = append_runtime_event(
                        app.handle(),
                        "startup_registration_error",
                        &json!({ "error": error.to_string() }).to_string(),
                    );
                }
                if let Err(error) = start_process_keep_alive(app.handle()) {
                    eprintln!("Daybridge 프로세스 감시자 시작 실패: {error}");
                    let _ = append_runtime_event(
                        app.handle(),
                        "process_watchdog_start_error",
                        &json!({ "error": error.to_string() }).to_string(),
                    );
                }
            }
            // The widget and its local HTTP bridge are separate processes. Start
            // the bridge from the same checkout when the app launches so a
            // Windows login cannot leave a visible but disconnected widget.
            if let Err(error) = start_local_bridge(app.handle()) {
                eprintln!("Daybridge 로컬 브리지 자동 시작 실패: {error}");
                let _ = append_runtime_event(
                    app.handle(),
                    "bridge_autostart_failed",
                    &json!({ "error": error }).to_string(),
                );
            }
            if let Some(window) = app.get_webview_window("overlay") {
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
            }
            let _ = ensure_overlay_visible(app.handle(), "app_setup");
            start_overlay_visibility_watchdog(app.handle().clone());
            let show = MenuItem::with_id(app, "show", "Daybridge 열기", true, None::<&str>)?;
            let show_overlay_item =
                MenuItem::with_id(app, "show_overlay", "위젯 다시 표시", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &show_overlay_item, &hide, &quit])?;

            TrayIconBuilder::with_id("daybridge-tray")
                .icon(
                    app.default_window_icon()
                        .expect("missing Daybridge icon")
                        .clone(),
                )
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = show_dashboard(app);
                    }
                    "show_overlay" => {
                        let _ = ensure_overlay_visible(app, "tray_menu");
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("dashboard") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        request_explicit_exit(app, "tray_quit");
                        let _ = append_runtime_event(app, "tray_quit_requested", "{}");
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
                        let _ = show_dashboard(&tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_dashboard,
            show_overlay,
            get_overlay_position,
            save_overlay_position,
            record_runtime_event,
            exit_app
        ])
        .on_window_event(|window, event| {
            if window.label() == "overlay" {
                if let WindowEvent::Moved(position) = event {
                    // Native move events are the durable source of truth. This
                    // also captures arbitrary drag positions, not just corner snaps.
                    let _ = persist_overlay_position(&window.app_handle(), position.x, position.y);
                }
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = append_runtime_event(
                    &window.app_handle(),
                    "window_close_requested",
                    &json!({ "window": window.label() }).to_string(),
                );
                if window.label() == "overlay" {
                    // The overlay has no user-facing close button. Treat an
                    // OS close request (for example Alt+F4 or a display
                    // manager action) as a visibility recovery request so a
                    // transient close cannot make the widget disappear while
                    // the Daybridge process is still running.
                    api.prevent_close();
                    let _ = append_runtime_event(
                        &window.app_handle(),
                        "overlay_close_ignored",
                        "{\"reason\":\"overlay_is_persistent\"}",
                    );
                    let _ = ensure_overlay_visible(&window.app_handle(), "close_requested");
                } else {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
            if let WindowEvent::Destroyed = event {
                let _ = append_runtime_event(
                    &window.app_handle(),
                    "window_destroyed",
                    &json!({ "window": window.label() }).to_string(),
                );
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Daybridge");
}

#[cfg(test)]
mod tests {
    use super::{keep_alive_script, position_is_outside_work_area};
    use std::path::Path;

    #[test]
    fn keeps_an_overlay_inside_the_current_work_area() {
        assert!(!position_is_outside_work_area(
            (1632, 976),
            (288, 64),
            (0, 0),
            (1920, 1040),
        ));
    }

    #[test]
    fn detects_an_overlay_lost_after_a_monitor_layout_change() {
        assert!(position_is_outside_work_area(
            (2400, 976),
            (288, 64),
            (0, 0),
            (1920, 1040),
        ));
    }

    #[test]
    fn keep_alive_script_relaunches_only_the_packaged_widget_until_explicit_exit() {
        let script = keep_alive_script(
            Path::new(r"C:\\Daybridge\\daybridge.exe"),
            Path::new(r"C:\\Daybridge\\explicit-exit.flag"),
            Path::new(r"C:\\Daybridge\\logs\\keep-alive-events.ndjson"),
        );

        assert!(script.contains("explicit-exit.flag"));
        assert!(script.contains("Start-Process -FilePath $ExecutablePath"));
        assert!(script.contains("Get-CimInstance Win32_Process"));
        assert!(script.contains("process_relaunch_requested"));
    }
}
