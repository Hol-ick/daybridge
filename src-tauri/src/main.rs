#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const OVERLAY_POSITION_FILE: &str = "overlay-position.json";
const WINDOWS_STARTUP_VALUE: &str = "Daybridge";

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

fn show_overlay(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.unminimize();
        let _ = window.show();
    }
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
    show_overlay(app);
    let window = dashboard_window(app)?;
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    Ok(())
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Only the packaged application registers itself. Development
            // builds depend on the local Vite server and must not become a
            // stale Windows startup entry after a reboot.
            if !cfg!(debug_assertions) {
                if let Err(error) = configure_windows_startup() {
                    eprintln!("Daybridge 자동 시작 등록 실패: {error}");
                }
            }
            if let Some(window) = app.get_webview_window("overlay") {
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
            }
            let show = MenuItem::with_id(app, "show", "Daybridge 열기", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

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
                    "hide" => {
                        if let Some(window) = app.get_webview_window("dashboard") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => app.exit(0),
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
            get_overlay_position,
            save_overlay_position
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
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Daybridge");
}
