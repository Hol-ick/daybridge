#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::json;
mod bridge_health;
mod bridge_runtime;
mod package_validation;
mod quick_memo;
mod memo_hotkey;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition, Position, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent, Emitter,
};

const OVERLAY_POSITION_FILE: &str = "overlay-position.json";
const RUNTIME_LOG_FILE: &str = "runtime-events.ndjson";
const WINDOWS_STARTUP_VALUE: &str = "Daybridge";
const LOCAL_BRIDGE_PORT: u16 = 39393;
const KEEP_ALIVE_SCRIPT_FILE: &str = "daybridge-keep-alive.ps1";
const EXPLICIT_EXIT_MARKER_FILE: &str = "explicit-exit.flag";
const OVERLAY_CANVAS_WIDTH: i32 = 760;
const OVERLAY_CANVAS_HEIGHT: i32 = 720;
const OVERLAY_CARD_WIDTH: i32 = 288;
const OVERLAY_COLLAPSED_HEIGHT: i32 = 64;
static SETTINGS_MODAL_OPEN: AtomicBool = AtomicBool::new(false);
static BRIDGE_INITIALIZATION_FINISHED: AtomicBool = AtomicBool::new(false);
static RUNTIME_LOG_WRITE: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
  $missingChecks = 0
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
    if ($running) {{
      $missingChecks = 0
    }} else {{
      $missingChecks += 1
    }}
    # WMI can briefly return no matching executable during login or a WebView
    # restart. Require three consecutive misses before relaunching so a
    # transient query does not create duplicate Daybridge processes.
    if (-not $running -and $missingChecks -ge 3) {{
      Write-DaybridgeEvent 'process_relaunch_requested' @{{ reason = 'widget_process_missing'; consecutiveMisses = $missingChecks }}
      try {{
        Start-Process -FilePath $ExecutablePath -WorkingDirectory $WorkingDirectory -WindowStyle Hidden
        $missingChecks = 0
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
    std::fs::write(
        &script_path,
        keep_alive_script(&executable, &exit_marker, &event_log),
    )
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
    bridge_health::bridge_is_reachable_at(bridge_endpoint())
}

#[cfg(windows)]
fn stop_existing_local_bridge(app: &tauri::AppHandle, script: &std::path::Path) -> Result<usize, String> {
    // The bridge is a separate Node process and survives when an older widget
    // executable is replaced. Restrict the stop operation to the exact script
    // path from the selected runtime; never terminate a process merely because it
    // happens to use the bridge port.
    let command_text = r#"
$ErrorActionPreference = 'Stop'
$target = $env:DAYBRIDGE_LOCAL_BRIDGE_SCRIPT
$listenerPids = @(Get-NetTCPConnection -LocalPort $env:DAYBRIDGE_LOCAL_BRIDGE_PORT -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
$matches = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $listenerPids -contains $_.ProcessId -and $_.CommandLine -and $_.CommandLine.IndexOf($target, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
})
foreach ($match in $matches) { Stop-Process -Id $match.ProcessId -Force }
$matches.Count
"#;
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(command_text)
        .env("DAYBRIDGE_LOCAL_BRIDGE_SCRIPT", script)
        .env("DAYBRIDGE_LOCAL_BRIDGE_PORT", LOCAL_BRIDGE_PORT.to_string())
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
    let output = command.output().map_err(|error| format!("기존 로컬 브리지를 확인할 수 없습니다: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "기존 로컬 브리지를 종료하지 못했습니다: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let stopped = String::from_utf8_lossy(&output.stdout).trim().parse::<usize>().unwrap_or(0);
    if stopped > 0 {
        let _ = append_runtime_event(
            app,
            "bridge_autostart_replacing_existing",
            &json!({ "port": LOCAL_BRIDGE_PORT, "stoppedCount": stopped }).to_string(),
        );
    }
    Ok(stopped)
}

#[cfg(not(windows))]
fn stop_existing_local_bridge(_app: &tauri::AppHandle, _script: &std::path::Path) -> Result<usize, String> {
    Ok(0)
}

fn start_local_bridge(app: &tauri::AppHandle) -> Result<(), String> {
    if bridge_health::probe_bridge(bridge_endpoint()) == bridge_health::BridgeProbe::ForeignListener {
        return Err("브리지 포트의 서비스가 호환되는 Daybridge인지 확인하지 못했습니다. 실행 진단을 확인해 주세요.".to_string());
    }
    let resources = app.path().resource_dir().map_err(|_| "앱 실행 리소스 경로를 확인할 수 없습니다.".to_string())?;
    let runtime = bridge_runtime::resolve_bridge_runtime(&resources, cfg!(debug_assertions))?;
    let script = runtime.script;

    if bridge_is_reachable() {
        let stopped = stop_existing_local_bridge(&app, &script)?;
        if stopped == 0 {
            let _ = append_runtime_event(
                app,
                "bridge_autostart_existing_unmanaged",
                &json!({ "port": LOCAL_BRIDGE_PORT }).to_string(),
            );
            return Ok(());
        }
        // The port can remain reserved for a moment after Node exits. Wait for
        // the exact bridge process to release it before starting the current
        // script, otherwise the new child would silently lose the bind race.
        for _ in 0..20 {
            if bridge_health::probe_bridge(bridge_endpoint()) == bridge_health::BridgeProbe::Unavailable {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        if bridge_health::probe_bridge(bridge_endpoint()) != bridge_health::BridgeProbe::Unavailable {
            let error = format!("기존 로컬 브리지가 {LOCAL_BRIDGE_PORT} 포트를 해제하지 않았습니다.");
            let _ = append_runtime_event(
                app,
                "bridge_autostart_replace_timeout",
                &json!({ "error": error, "port": LOCAL_BRIDGE_PORT }).to_string(),
            );
            return Err(error);
        }
    }

    let mut command = Command::new(&runtime.node);
    command
        .arg(&script)
        .current_dir(&runtime.working_directory)
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
        &json!({ "port": LOCAL_BRIDGE_PORT, "pid": child.id(), "runtimeSource": format!("{:?}", runtime.source) }).to_string(),
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

#[tauri::command]
async fn wait_for_initial_bridge() -> Result<(), String> {
    // Observe setup without launching/replacing a bridge from an early WebView
    // invocation. The blocking wait must not occupy the native setup thread.
    tauri::async_runtime::spawn_blocking(|| {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !BRIDGE_INITIALIZATION_FINISHED.load(Ordering::Acquire) {
            if Instant::now() >= deadline {
                return Err("로컬 브리지 초기화 대기 시간이 초과됐습니다.".to_string());
            }
            thread::sleep(Duration::from_millis(25));
        }
        if bridge_is_reachable() {
            Ok(())
        } else {
            Err("로컬 브리지 초기화를 확인하지 못했습니다. 실행 진단을 확인해 주세요.".to_string())
        }
    })
    .await
    .map_err(|error| format!("로컬 브리지 초기화 확인에 실패했습니다: {error}"))?
}

#[tauri::command]
fn ensure_local_bridge(app: tauri::AppHandle) -> Result<bool, String> {
    if bridge_is_reachable() {
        return Ok(false);
    }
    let _ = append_runtime_event(
        &app,
        "bridge_recovery_requested",
        &json!({ "source": "webview_request", "port": LOCAL_BRIDGE_PORT }).to_string(),
    );
    start_local_bridge(&app)?;
    Ok(true)
}

fn start_local_bridge_watchdog(app: tauri::AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(5));
        if bridge_is_reachable() {
            continue;
        }
        let _ = append_runtime_event(
            &app,
            "bridge_watchdog_recovery_requested",
            &json!({ "port": LOCAL_BRIDGE_PORT }).to_string(),
        );
        if let Err(error) = start_local_bridge(&app) {
            let _ = append_runtime_event(
                &app,
                "bridge_watchdog_recovery_error",
                &json!({ "error": error, "port": LOCAL_BRIDGE_PORT }).to_string(),
            );
        }
    });
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
    write_runtime_record(&path, &record)
}

fn write_runtime_record(path: &std::path::Path, record: &serde_json::Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(record).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    // Formatting directly into File performs multiple writes which can interleave
    // with the hotkey thread. Keep each complete record under one writer guard.
    let _guard = RUNTIME_LOG_WRITE.lock().map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())
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

#[cfg(windows)]
fn apply_taskbar_exclusion_style(window: &WebviewWindow) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_APPWINDOW,
        WS_EX_TOOLWINDOW,
    };

    let handle = window.hwnd().map_err(|error| error.to_string())?;
    let current_style = unsafe { GetWindowLongPtrW(handle, GWL_EXSTYLE) };
    let next_style = (current_style & !(WS_EX_APPWINDOW.0 as isize))
        | (WS_EX_TOOLWINDOW.0 as isize);
    if current_style == next_style {
        return Ok(());
    }

    unsafe {
        SetWindowLongPtrW(handle, GWL_EXSTYLE, next_style);
        SetWindowPos(
            handle,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        .map_err(|error| error.to_string())?;
    }
    let _ = append_runtime_event(
        &window.app_handle(),
        "window_taskbar_style_applied",
        &json!({
            "removed": "WS_EX_APPWINDOW",
            "added": "WS_EX_TOOLWINDOW",
        })
        .to_string(),
    );
    Ok(())
}

#[cfg(not(windows))]
fn apply_taskbar_exclusion_style(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

fn apply_overlay_taskbar_style(window: &WebviewWindow) -> Result<(), String> {
    apply_taskbar_exclusion_style(window)
}

/// Tauri declares the overlay undecorated, but Windows can still preserve the
/// previous caption style on a transparent topmost WebView. The compact card
/// hides that chrome through its small region; opening settings reveals it.
/// Remove the non-client chrome once during startup, after Tauri completes its
/// initial visibility recovery, so the full-size settings region remains a
/// clean app-owned surface.
#[cfg(windows)]
fn remove_overlay_window_chrome(app: &tauri::AppHandle, window: &WebviewWindow) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CAPTION, WS_MAXIMIZEBOX,
        WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
    };

    let handle = window.hwnd().map_err(|error| error.to_string())?;
    let chrome_flags = (WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0) as isize;
    let current_style = unsafe { GetWindowLongPtrW(handle, GWL_STYLE) };
    if current_style & chrome_flags == 0 {
        return Ok(());
    }

    unsafe {
        SetWindowLongPtrW(handle, GWL_STYLE, current_style & !chrome_flags);
        SetWindowPos(
            handle,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        .map_err(|error| error.to_string())?;
    }
    let _ = append_runtime_event(
        app,
        "overlay_window_chrome_removed",
        &json!({ "removedFlags": format!("0x{chrome_flags:X}") }).to_string(),
    );
    Ok(())
}

#[cfg(not(windows))]
fn remove_overlay_window_chrome(_app: &tauri::AppHandle, _window: &WebviewWindow) -> Result<(), String> {
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
    if !SETTINGS_MODAL_OPEN.load(Ordering::Relaxed) {
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    force_native_overlay_visible(&window)?;
    apply_overlay_taskbar_style(&window)?;
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

    let window = WebviewWindowBuilder::new(
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
    .build()?;
    if let Err(error) = apply_taskbar_exclusion_style(&window) {
        let _ = append_runtime_event(
            app,
            "dashboard_taskbar_style_error",
            &json!({ "error": error }).to_string(),
        );
    }
    Ok(window)
}

fn show_dashboard(app: &tauri::AppHandle) -> tauri::Result<()> {
    let _ = ensure_overlay_visible(app, "dashboard_open");
    let window = dashboard_window(app)?;
    window.unminimize()?;
    window.show()?;
    if let Err(error) = apply_taskbar_exclusion_style(&window) {
        let _ = append_runtime_event(
            app,
            "dashboard_taskbar_style_error",
            &json!({ "error": error }).to_string(),
        );
    }
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
fn open_dashboard_settings(app: tauri::AppHandle) -> Result<(), String> {
    show_dashboard(&app).map_err(|error| error.to_string())?;
    app.emit("daybridge:open-settings", ()).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_daybridge_data_directory(path: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let directory = path.filter(|value| !value.trim().is_empty()).map(PathBuf::from).unwrap_or_else(|| {
            std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default().join("Daybridge")
        });
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        Command::new("explorer.exe")
            .arg(directory)
            .spawn()
            .map_err(|error| format!("Daybridge 로컬 폴더를 열 수 없습니다: {error}"))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    { Err("로컬 폴더 열기는 Windows에서만 지원합니다.".to_string()) }
}

#[tauri::command]
fn get_overlay_position(app: tauri::AppHandle) -> Option<[i32; 2]> {
    read_overlay_position(&app)
}

#[tauri::command]
fn save_overlay_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    persist_overlay_position(&app, x, y)
}

/// Restrict a fixed transparent canvas to its currently painted card. This
/// changes visibility and hit-testing without rebuilding the WebView's native
/// surface, which is essential for a smooth bottom-anchored card animation.
#[cfg(windows)]
fn apply_overlay_interaction_region(
    window: &WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    use windows::core::Free;
    use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};

    let handle = window.hwnd().map_err(|error| error.to_string())?;
    let mut region = unsafe {
        CreateRoundRectRgn(
            x,
            y,
            x.saturating_add(width),
            y.saturating_add(height),
            22,
            22,
        )
    };
    if unsafe { SetWindowRgn(handle, Some(region), false) } == 0 {
        unsafe { region.free() };
        return Err("위젯의 클릭 가능한 영역을 갱신하지 못했습니다.".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn apply_overlay_interaction_region(
    _window: &WebviewWindow,
    _x: i32,
    _y: i32,
    _width: i32,
    _height: i32,
) -> Result<(), String> {
    Ok(())
}

fn prepare_overlay_canvas(app: &tauri::AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(app.primary_monitor().map_err(|error| error.to_string())?);
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let work_area = monitor.work_area();
    let x = work_area.position.x
        + i32::try_from(work_area.size.width).unwrap_or(i32::MAX)
        - OVERLAY_CANVAS_WIDTH;
    let y = work_area.position.y
        + i32::try_from(work_area.size.height).unwrap_or(i32::MAX)
        - OVERLAY_CANVAS_HEIGHT;
    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| error.to_string())?;
    apply_overlay_interaction_region(
        window,
        OVERLAY_CANVAS_WIDTH - OVERLAY_CARD_WIDTH,
        OVERLAY_CANVAS_HEIGHT - OVERLAY_COLLAPSED_HEIGHT,
        OVERLAY_CARD_WIDTH,
        OVERLAY_COLLAPSED_HEIGHT,
    )?;
    persist_overlay_position(app, x, y)
}

#[tauri::command]
fn set_overlay_interaction_region(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "오버레이 창을 찾을 수 없습니다.".to_string())?;
    let safe_x = x.clamp(0, OVERLAY_CANVAS_WIDTH - 1);
    let safe_y = y.clamp(0, OVERLAY_CANVAS_HEIGHT - 1);
    let safe_width = i32::try_from(width)
        .map_err(|error| error.to_string())?
        .clamp(1, OVERLAY_CANVAS_WIDTH - safe_x);
    let safe_height = i32::try_from(height)
        .map_err(|error| error.to_string())?
        .clamp(1, OVERLAY_CANVAS_HEIGHT - safe_y);
    apply_overlay_interaction_region(&window, safe_x, safe_y, safe_width, safe_height)?;
    let _ = append_runtime_event(
        &app,
        "overlay_interaction_region_applied",
        &json!({
            "x": safe_x,
            "y": safe_y,
            "width": safe_width,
            "height": safe_height,
        })
        .to_string(),
    );
    Ok(())
}

#[tauri::command]
fn set_overlay_settings_mode(open: bool) -> Result<(), String> {
    SETTINGS_MODAL_OPEN.store(open, Ordering::Relaxed);
    Ok(())
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
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if let Some(result) = package_validation::run_if_requested(&args) {
        match result {
            Ok(()) => std::process::exit(0),
            Err(error) => {
                eprintln!("Daybridge package validation failed: {error}");
                std::process::exit(2);
            }
        }
    }
    tauri::Builder::default()
        .manage(quick_memo::MemoStore(std::sync::Mutex::new(())))
        .setup(|app| {
            app.manage(memo_hotkey::MemoHotkey::start(app.handle().clone()));
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
            // the bundled runtime (or debug checkout) when the app launches so a
            // Windows login cannot leave a visible but disconnected widget.
            if let Err(error) = start_local_bridge(app.handle()) {
                eprintln!("Daybridge 로컬 브리지 자동 시작 실패: {error}");
                let _ = append_runtime_event(
                    app.handle(),
                    "bridge_autostart_failed",
                    &json!({ "error": error }).to_string(),
                );
            }
            BRIDGE_INITIALIZATION_FINISHED.store(true, Ordering::Release);
            start_local_bridge_watchdog(app.handle().clone());
            if let Some(window) = app.get_webview_window("overlay") {
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
                if let Err(error) = prepare_overlay_canvas(app.handle(), &window) {
                    let _ = append_runtime_event(
                        app.handle(),
                        "overlay_canvas_prepare_error",
                        &json!({ "error": error }).to_string(),
                    );
                }
            }
            if let Some(window) = app.get_webview_window("dashboard") {
                if let Err(error) = apply_taskbar_exclusion_style(&window) {
                    let _ = append_runtime_event(
                        app.handle(),
                        "dashboard_taskbar_style_error",
                        &json!({ "error": error }).to_string(),
                    );
                }
            }
            let _ = ensure_overlay_visible(app.handle(), "app_setup");
            if let Some(window) = app.get_webview_window("overlay") {
                if let Err(error) = remove_overlay_window_chrome(app.handle(), &window) {
                    let _ = append_runtime_event(
                        app.handle(),
                        "overlay_window_chrome_remove_error",
                        &json!({ "error": error }).to_string(),
                    );
                }
            }
            start_overlay_visibility_watchdog(app.handle().clone());
            let show = MenuItem::with_id(app, "show", "Daybridge 열기", true, None::<&str>)?;
            let show_overlay_item =
                MenuItem::with_id(app, "show_overlay", "위젯 다시 표시", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let memo = MenuItem::with_id(app, "memo", "메모 열기 (Ctrl+D)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&memo, &show, &show_overlay_item, &hide, &quit])?;

            TrayIconBuilder::with_id("daybridge-tray")
                .icon(
                    app.default_window_icon()
                        .expect("missing Daybridge icon")
                        .clone(),
                )
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "memo" => { let _ = quick_memo::show(app); }
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
            quick_memo::open_quick_memo,
            quick_memo::read_quick_memo,
            quick_memo::save_quick_memo,
            quick_memo::hide_quick_memo,
            memo_hotkey::memo_shortcut_status,
            open_dashboard,
            open_dashboard_settings,
            open_daybridge_data_directory,
            show_overlay,
            get_overlay_position,
            save_overlay_position,
            set_overlay_interaction_region,
            set_overlay_settings_mode,
            record_runtime_event,
            wait_for_initial_bridge,
            ensure_local_bridge,
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
                if window.label() == "memo" {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
                let _ = append_runtime_event(
                    &window.app_handle(),
                    "window_close_requested",
                    &json!({ "window": window.label() }).to_string(),
                );
                api.prevent_close();
                let app = window.app_handle();
                let reason = format!("{}_close_requested", window.label());
                let _ = append_runtime_event(
                    &app,
                    "window_close_requested_exit",
                    &json!({ "window": window.label() }).to_string(),
                );
                request_explicit_exit(&app, &reason);
                app.exit(0);
            }
            if let WindowEvent::Destroyed = event {
                let _ = append_runtime_event(
                    &window.app_handle(),
                    "window_destroyed",
                    &json!({ "window": window.label() }).to_string(),
                );
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Daybridge")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<memo_hotkey::MemoHotkey>().stop();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{keep_alive_script, position_is_outside_work_area};
    use std::path::Path;

    #[test]
    fn concurrent_native_events_remain_complete_json_lines() {
        let root = std::env::temp_dir().join(format!("daybridge-native-log-{}-{}", std::process::id(), super::SystemTime::now().duration_since(super::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("events.ndjson");
        std::thread::scope(|scope| {
            for worker in 0..4 {
                let path = &path;
                scope.spawn(move || {
                    for sequence in 0..25 {
                        super::write_runtime_record(path, &serde_json::json!({"worker":worker,"sequence":sequence})).unwrap();
                    }
                });
            }
        });
        let text = std::fs::read_to_string(&path).unwrap();
        let records: std::collections::HashSet<_> = text.lines().map(|line| {
            let value: serde_json::Value = serde_json::from_str(line).unwrap();
            (value["worker"].as_u64().unwrap(), value["sequence"].as_u64().unwrap())
        }).collect();
        assert_eq!(text.lines().count(), 100);
        assert_eq!(records.len(), 100);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

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
        assert!(script.contains("$missingChecks -ge 3"));
        assert!(script.contains("consecutiveMisses"));
        assert!(script.contains("process_relaunch_requested"));
    }
}
