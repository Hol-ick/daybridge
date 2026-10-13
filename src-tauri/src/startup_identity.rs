use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum LaunchRole {
    Installed,
    Standalone,
    Redirect(PathBuf),
}

pub fn launch_role(current: &Path, installed: Option<&Path>) -> LaunchRole {
    match installed {
        Some(installed) if same_file(current, installed) => LaunchRole::Installed,
        Some(installed) => LaunchRole::Redirect(installed.to_path_buf()),
        None => LaunchRole::Standalone,
    }
}

fn same_file(a: &Path, b: &Path) -> bool {
    let a = std::fs::canonicalize(a).unwrap_or_else(|_| a.to_path_buf());
    let b = std::fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf());
    if cfg!(windows) {
        a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy())
    } else {
        a == b
    }
}

#[cfg(windows)]
pub fn installed_executable() -> Option<PathBuf> {
    use winreg::{enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE}, RegKey};
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let key = RegKey::predef(hive)
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Daybridge");
        if let Ok(key) = key {
            if let Ok(location) = key.get_value::<String, _>("InstallLocation") {
                let root = PathBuf::from(location.trim_matches('"'));
                let executable = root.join("daybridge.exe");
                if root.is_absolute() && executable.is_file() && root.join("uninstall.exe").is_file() {
                    return Some(executable);
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
pub fn installed_executable() -> Option<PathBuf> { None }

#[cfg(windows)]
pub struct InstanceGuard(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Drop for InstanceGuard {
    fn drop(&mut self) {
        unsafe { let _ = windows::Win32::Foundation::CloseHandle(self.0); }
    }
}

#[cfg(windows)]
pub fn acquire_instance() -> Result<Option<InstanceGuard>, String> {
    use windows::{core::w, Win32::{Foundation::{GetLastError, ERROR_ALREADY_EXISTS, CloseHandle}, System::Threading::CreateMutexW}};
    unsafe {
        let handle = CreateMutexW(None, false, w!("Local\\DaybridgeWidgetApplication"))
            .map_err(|error| format!("Daybridge 실행 잠금 실패: {error}"))?;
        if GetLastError() == ERROR_ALREADY_EXISTS {
            let _ = CloseHandle(handle);
            Ok(None)
        } else {
            Ok(Some(InstanceGuard(handle)))
        }
    }
}

#[cfg(not(windows))]
pub struct InstanceGuard;
#[cfg(not(windows))]
pub fn acquire_instance() -> Result<Option<InstanceGuard>, String> { Ok(Some(InstanceGuard)) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_copy_redirects_without_taking_startup_ownership() {
        let installed = Path::new("installed/daybridge.exe");
        assert_eq!(launch_role(Path::new("target/release/daybridge.exe"), Some(installed)), LaunchRole::Redirect(installed.to_path_buf()));
        assert_eq!(launch_role(Path::new("validation/daybridge.exe"), Some(installed)), LaunchRole::Redirect(installed.to_path_buf()));
    }
    #[test]
    fn only_the_registered_installation_owns_startup() {
        let installed = Path::new("installed/daybridge.exe");
        assert_eq!(launch_role(installed, Some(installed)), LaunchRole::Installed);
        assert_eq!(launch_role(installed, None), LaunchRole::Standalone);
    }
    #[cfg(windows)]
    #[test]
    fn windows_installation_paths_ignore_case() {
        assert_eq!(launch_role(Path::new(r"C:\Apps\Daybridge\daybridge.exe"), Some(Path::new(r"c:\apps\daybridge\DAYBRIDGE.EXE"))), LaunchRole::Installed);
    }
}
