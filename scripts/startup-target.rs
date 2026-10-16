use std::path::{Path, PathBuf};

pub fn select_installation(roots: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    roots.into_iter().find_map(|root| {
        let executable = root.join("daybridge.exe");
        (root.is_absolute() && executable.is_file() && root.join("uninstall.exe").is_file())
            .then_some(executable)
    })
}

pub fn installed_executable() -> Option<PathBuf> {
    let mut roots = registry_installations();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Programs").join("Daybridge"));
    }
    select_installation(roots)
}

pub fn same_file(a: &Path, b: &Path) -> bool {
    let a = std::fs::canonicalize(a).unwrap_or_else(|_| a.to_path_buf());
    let b = std::fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf());
    if cfg!(windows) { a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy()) }
    else { a == b }
}

#[cfg(windows)]
fn registry_installations() -> Vec<PathBuf> {
    use std::{ffi::c_void, os::windows::ffi::OsStringExt};
    #[link(name = "advapi32")]
    extern "system" {
        fn RegGetValueW(key: isize, subkey: *const u16, value: *const u16, flags: u32,
            kind: *mut u32, data: *mut c_void, size: *mut u32) -> i32;
    }
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let subkey = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Daybridge");
    let value = wide("InstallLocation");
    let mut roots = Vec::new();
    for hive in [0x80000001u32, 0x80000002u32] {
        for view in [0x00010000u32, 0x00020000u32] {
            let mut data = [0u16; 32768];
            let mut bytes = (data.len() * 2) as u32;
            // Read the complete REG_SZ from both registry views. No write access.
            let status = unsafe { RegGetValueW(hive as i32 as isize, subkey.as_ptr(), value.as_ptr(),
                0x2 | view, std::ptr::null_mut(), data.as_mut_ptr().cast(), &mut bytes) };
            if status == 0 {
                let end = data.iter().position(|&c| c == 0).unwrap_or(data.len());
                let raw = std::ffi::OsString::from_wide(&data[..end]);
                roots.push(PathBuf::from(raw.to_string_lossy().trim().trim_matches('"')));
            }
        }
    }
    roots
}

#[cfg(not(windows))]
fn registry_installations() -> Vec<PathBuf> { Vec::new() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_registry_can_fall_back_to_a_complete_local_installation() {
        let root = std::env::temp_dir().join(format!("daybridge-startup-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("daybridge.exe"), b"fixture").unwrap();
        assert_eq!(select_installation([root.clone()]), None);
        std::fs::write(root.join("uninstall.exe"), b"fixture").unwrap();
        assert_eq!(select_installation([root.join("missing-registry-root"), root.clone()]), Some(root.join("daybridge.exe")));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn relative_or_missing_installations_are_not_launch_targets() {
        assert_eq!(select_installation([PathBuf::from("target/release"), PathBuf::from("missing")]), None);
    }
}
