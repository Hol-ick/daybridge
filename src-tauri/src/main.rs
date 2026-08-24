#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("overlay") {
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
            }
            let show = MenuItem::with_id(app, "show", "Daybridge 열기", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

            TrayIconBuilder::with_id("daybridge-tray")
                .icon(app.default_window_icon().expect("missing Daybridge icon").clone())
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
        .invoke_handler(tauri::generate_handler![open_dashboard])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Daybridge");
}
