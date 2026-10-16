#![cfg_attr(not(test), windows_subsystem = "windows")]
#[path = "startup-target.rs"]
mod startup_target;

fn main() {
    let Some(target) = startup_target::installed_executable() else { std::process::exit(2) };
    let Ok(current) = std::env::current_exe() else { std::process::exit(2) };
    if startup_target::same_file(&current, &target) { std::process::exit(2) }
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--probe")) {
        println!("{}", target.display());
        return;
    }
    // This executable has no UI, bridge, startup registration or recovery loop.
    // An obsolete shortcut can only reach the current installed application.
    if std::process::Command::new(&target).current_dir(target.parent().unwrap()).spawn().is_err() {
        std::process::exit(2);
    }
}
