use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
type Result<T> = std::result::Result<T, String>;
fn fail(_: impl std::fmt::Display) -> String {
    "update_io_failed".into()
}
fn hash(path: &Path) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(fs::read(path).map_err(fail)?)
    ))
}
pub fn read_json(path: &Path) -> Result<Value> {
    let b = fs::read(path).map_err(fail)?;
    serde_json::from_slice(b.strip_prefix(&[239, 187, 191]).unwrap_or(&b)).map_err(fail)
}
fn text<'a>(v: &'a Value, k: &str) -> Result<&'a str> {
    v[k].as_str().ok_or_else(|| "invalid_plan".into())
}
fn path(v: &Value, k: &str) -> Result<PathBuf> {
    Ok(PathBuf::from(text(v, k)?))
}
fn write(path: &Path, v: &Value) -> Result<()> {
    let temp = path.with_extension("tmp");
    fs::write(&temp, v.to_string()).map_err(fail)?;
    fs::rename(&temp, path).map_err(fail)
}
fn no_link(path: &Path) -> Result<()> {
    let m = fs::symlink_metadata(path).map_err(fail)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err("reparse_point".into());
        }
    }
    if m.file_type().is_symlink() {
        return Err("reparse_point".into());
    }
    Ok(())
}
fn inventory(root: &Path) -> Result<Vec<(PathBuf, String)>> {
    fn visit(base: &Path, dir: &Path, out: &mut Vec<(PathBuf, String)>) -> Result<()> {
        no_link(dir)?;
        for e in fs::read_dir(dir).map_err(fail)? {
            let p = e.map_err(fail)?.path();
            no_link(&p)?;
            if p.is_dir() {
                visit(base, &p, out)?
            } else {
                out.push((p.strip_prefix(base).map_err(fail)?.to_path_buf(), hash(&p)?));
            }
        }
        Ok(())
    }
    let mut list = vec![];
    if root.exists() {
        visit(root, root, &mut list)?;
    }
    list.sort();
    Ok(list)
}
fn copy_inventory(source: &Path, destination: &Path, files: &[(PathBuf, String)]) -> Result<()> {
    no_link(source)?;
    if destination.exists() {
        no_link(destination)?;
    }
    for (rel, expected) in files {
        let src = source.join(rel);
        let dest = destination.join(rel);
        if hash(&src)? != *expected {
            return Err("backup_changed".into());
        }
        fs::create_dir_all(dest.parent().ok_or("invalid_destination")?).map_err(fail)?;
        if dest.exists() {
            no_link(&dest)?;
        }
        fs::copy(src, &dest).map_err(fail)?;
        if hash(&dest)? != *expected {
            return Err("copy_verification_failed".into());
        }
    }
    Ok(())
}
pub fn verify_package(bytes: &[u8], signature: &str) -> Result<()> {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).map_err(fail)?;
    let decode = |s: &str| -> Result<String> {
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(s.trim())
                .map_err(|_| "signature_invalid")?,
        )
        .map_err(|_| "signature_invalid".into())
    };
    let key = minisign_verify::PublicKey::decode(&decode(text(
        &config["plugins"]["updater"],
        "pubkey",
    )?)?)
    .map_err(|_| "signature_invalid")?;
    let signature =
        minisign_verify::Signature::decode(&decode(signature)?).map_err(|_| "signature_invalid")?;
    key.verify(bytes, &signature, true)
        .map_err(|_| "signature_invalid".into())
}
trait Host {
    fn wait_parent(&mut self, root: &Path) -> Result<()>;
    fn stop_old_bridge(&mut self) -> Result<()>;
    fn install(&mut self, package: &Path, installation: &Path) -> Result<()>;
    fn launch_and_verify(&mut self, plan_path: &Path, plan: &Value) -> Result<()>;
    fn stop_new(&mut self, plan: &Value) -> Result<()>;
    fn restore_launch(&mut self, plan: &Value) -> Result<()>;
    fn parent_running(&self) -> bool;
    fn installer_running(&mut self) -> bool {
        false
    }
}
fn state(root: &Path, version: &str, phase: &str, code: &str) -> Result<()> {
    write(
        &root.join("result.json"),
        &json!({"version":version,"phase":phase,"code":code}),
    )
}
fn assert_data(plan: &Value, memos: &[(PathBuf, String)]) -> Result<()> {
    let memo = path(plan, "memoState")?;
    if !crate::automatic_update::memo_idle(&memo) {
        return Err("memo_in_use".into());
    }
    if inventory(memo.parent().ok_or("invalid_memo_path")?)? != memos {
        return Err("memo_files_changed".into());
    }
    if hash(&path(plan, "pointer")?)? != text(plan, "pointerHash")? {
        return Err("data_pointer_changed".into());
    }
    Ok(())
}
fn transaction(root: &Path, plan: &Value, host: &mut impl Host) -> Result<()> {
    let version = text(plan, "version")?;
    let install = path(plan, "install")?;
    let exe = install.join("daybridge.exe");
    let package = root.join("update.exe");
    if hash(&exe)? != text(plan, "oldHash")? || hash(&package)? != text(plan, "installerHash")? {
        return Err("payload_changed".into());
    }
    let memo = path(plan, "memoState")?;
    let memos = inventory(memo.parent().ok_or("invalid_memo_path")?)?;
    assert_data(plan, &memos)?;
    let files = inventory(&install)?;
    let backup = root.join("previous-program");
    let mut changed = false;
    let result = (|| {
        state(root, version, "backing_up", "")?;
        copy_inventory(&install, &backup, &files)?;
        assert_data(plan, &memos)?;
        fs::write(root.join("prepared"), "ready").map_err(fail)?;
        host.wait_parent(root)?;
        host.stop_old_bridge()?;
        assert_data(plan, &memos)?;
        if hash(&package)? != text(plan, "installerHash")? {
            return Err("payload_changed".into());
        }
        state(root, version, "installing", "")?;
        changed = true;
        host.install(&package, &install)?;
        assert_data(plan, &memos)?;
        state(root, version, "starting", "")?;
        host.launch_and_verify(&root.join("plan.json"), plan)?;
        state(root, version, "completed", "")
    })();
    if let Err(code) = result {
        state(root, version, "failed", &code)?;
        if host.installer_running() {
            state(root, version, "installer_still_running", &code)?;
            return Err(code);
        }
        if changed {
            host.stop_new(plan)?;
            copy_inventory(&backup, &install, &files)?;
            write(
                &root
                    .parent()
                    .ok_or("invalid_cache")?
                    .join("failed-version.json"),
                &json!({"version":version,"code":code}),
            )?;
        }
        if !host.parent_running() && hash(&exe)? == text(plan, "oldHash")? {
            host.restore_launch(plan)?;
            state(root, version, "rolled_back", &code)?;
        } else {
            state(root, version, "aborted", &code)?;
        }
        return Err(code);
    }
    Ok(())
}

#[cfg(windows)]
mod native {
    use super::*;
    use windows::{
        core::PWSTR,
        Win32::{
            Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_OBJECT_0},
            System::{Diagnostics::ToolHelp::*, Threading::*},
        },
    };
    pub(super) struct Process {
        handle: HANDLE,
    }
    impl Drop for Process {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.handle);
            }
        }
    }
    impl Process {
        pub(super) fn open(pid: u32) -> Result<Self> {
            Ok(Self {
                handle: unsafe {
                    OpenProcess(
                        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE | PROCESS_TERMINATE,
                        false,
                        pid,
                    )
                }
                .map_err(|_| "process_unavailable")?,
            })
        }
        pub(super) fn name(&self) -> Result<PathBuf> {
            let mut buffer = vec![0u16; 32768];
            let mut len = buffer.len() as u32;
            unsafe {
                QueryFullProcessImageNameW(
                    self.handle,
                    PROCESS_NAME_WIN32,
                    PWSTR(buffer.as_mut_ptr()),
                    &mut len,
                )
            }
            .map_err(|_| "process_path_failed")?;
            Ok(String::from_utf16_lossy(&buffer[..len as usize]).into())
        }
        pub(super) fn ticks(&self) -> Result<String> {
            let (mut a, mut b, mut c, mut d) = (
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
            );
            unsafe { GetProcessTimes(self.handle, &mut a, &mut b, &mut c, &mut d) }
                .map_err(|_| "process_time_failed")?;
            Ok(
                ((((a.dwHighDateTime as u64) << 32) | a.dwLowDateTime as u64) + 504911232000000000)
                    .to_string(),
            )
        }
        pub(super) fn running(&self) -> bool {
            (unsafe { WaitForSingleObject(self.handle, 0) }) != WAIT_OBJECT_0
        }
        fn stop(&self) -> Result<()> {
            if self.running() {
                unsafe { TerminateProcess(self.handle, 1) }
                    .map_err(|_| "owned_process_stop_failed")?;
                if unsafe { WaitForSingleObject(self.handle, 10000) } != WAIT_OBJECT_0 {
                    return Err("owned_process_stop_timeout".into());
                }
            }
            Ok(())
        }
    }
    fn owned_bridges(parent: u32, install: &Path) -> Result<Vec<Process>> {
        let snapshot = Process {
            handle: unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
                .map_err(|_| "process_inventory_failed")?,
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut list = vec![];
        let mut next = unsafe { Process32FirstW(snapshot.handle, &mut entry) };
        while next.is_ok() {
            if entry.th32ParentProcessID == parent {
                if let Ok(process) = Process::open(entry.th32ProcessID) {
                    if process.name().ok() == Some(install.join("bridge-runtime/node.exe")) {
                        list.push(process);
                    }
                }
            }
            next = unsafe { Process32NextW(snapshot.handle, &mut entry) };
        }
        Ok(list)
    }
    fn launch(exe: &Path, plan: Option<&Path>) -> Result<Child> {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new(exe);
        cmd.current_dir(exe.parent().ok_or("invalid_installation")?)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000);
        cmd.env_remove("DAYBRIDGE_UPDATE_PLAN")
            .env_remove("DAYBRIDGE_PACKAGE_VALIDATION")
            .env_remove("DAYBRIDGE_BRIDGE_PORT");
        if let Some(path) = plan {
            cmd.env("DAYBRIDGE_UPDATE_PLAN", path);
        }
        cmd.spawn().map_err(|_| "app_launch_failed".into())
    }
    pub struct NativeHost {
        parent: Process,
        old_bridges: Vec<Process>,
        new_app: Option<Child>,
        setup: Option<Child>,
        install: PathBuf,
        root: PathBuf,
    }
    impl Host for NativeHost {
        fn parent_running(&self) -> bool {
            self.parent.running()
        }
        fn wait_parent(&mut self, root: &Path) -> Result<()> {
            let deadline = Instant::now() + Duration::from_secs(150);
            while self.parent.running() {
                if root.join("abort").exists() {
                    return Err("application_in_use".into());
                }
                if Instant::now() > deadline {
                    return Err("app_exit_timeout".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Ok(())
        }
        fn stop_old_bridge(&mut self) -> Result<()> {
            for process in &self.old_bridges {
                process.stop()?;
            }
            let endpoint = std::net::SocketAddr::from(([127, 0, 0, 1], 39393));
            for _ in 0..60 {
                if crate::bridge_health::probe_bridge(endpoint)
                    == crate::bridge_health::BridgeProbe::Unavailable
                {
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            Err("bridge_port_occupied".into())
        }
        fn install(&mut self, package: &Path, installation: &Path) -> Result<()> {
            use std::os::windows::process::CommandExt;
            self.setup = Some(
                Command::new(package)
                    .arg("/S")
                    .arg(format!("/D={}", installation.display()))
                    .creation_flags(0x08000000)
                    .spawn()
                    .map_err(|_| "installer_start_failed")?,
            );
            let deadline = Instant::now() + Duration::from_secs(180);
            while Instant::now() < deadline {
                if let Some(code) = self.setup.as_mut().unwrap().try_wait().map_err(fail)? {
                    return if code.success() {
                        Ok(())
                    } else {
                        Err("installer_failed".into())
                    };
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            Err("installer_timeout".into())
        }
        fn installer_running(&mut self) -> bool {
            self.setup
                .as_mut()
                .is_some_and(|p| p.try_wait().ok().flatten().is_none())
        }
        fn launch_and_verify(&mut self, plan_path: &Path, plan: &Value) -> Result<()> {
            self.new_app = Some(launch(
                &self.install.join("daybridge.exe"),
                Some(plan_path),
            )?);
            let pid = self.new_app.as_ref().unwrap().id();
            let deadline = Instant::now() + Duration::from_secs(90);
            while Instant::now() < deadline {
                if self
                    .new_app
                    .as_mut()
                    .unwrap()
                    .try_wait()
                    .map_err(fail)?
                    .is_some()
                {
                    return Err("new_app_exited".into());
                }
                let ready = self.root.join("ready.json");
                if ready.exists() {
                    let ack = read_json(&ready)?;
                    if ack["pid"].as_u64() != Some(pid as u64)
                        || ack["version"] != plan["version"]
                        || ack["token"] != plan["token"]
                    {
                        return Err("readiness_identity_changed".into());
                    }
                    if owned_bridges(pid, &self.install)?.len() != 1
                        || !crate::bridge_health::bridge_is_reachable_at(
                            ([127, 0, 0, 1], 39393).into(),
                        )
                    {
                        return Err("new_bridge_not_ready".into());
                    }
                    if hash(&path(plan, "pointer")?)? != text(plan, "pointerHash")? {
                        return Err("data_pointer_changed".into());
                    }
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            Err("new_app_readiness_timeout".into())
        }
        fn stop_new(&mut self, plan: &Value) -> Result<()> {
            if !crate::automatic_update::memo_idle(&path(plan, "memoState")?) {
                state(
                    &self.root,
                    text(plan, "version")?,
                    "rollback_deferred",
                    "memo_in_use",
                )?;
                return Err("rollback_deferred_memo_in_use".into());
            }
            fs::write(path(plan, "marker")?, "update_rollback").map_err(fail)?;
            std::thread::sleep(Duration::from_secs(4));
            if let Some(child) = self.new_app.as_mut() {
                let bridges = owned_bridges(child.id(), &self.install)?;
                if child.try_wait().map_err(fail)?.is_none() {
                    child.kill().map_err(fail)?;
                    child.wait().map_err(fail)?;
                }
                for bridge in bridges {
                    bridge.stop()?;
                }
            }
            Ok(())
        }
        fn restore_launch(&mut self, _: &Value) -> Result<()> {
            launch(&self.install.join("daybridge.exe"), None)?;
            Ok(())
        }
    }
    pub fn run(plan_path: &Path) -> Result<()> {
        let root = plan_path.parent().ok_or("invalid_cache")?.to_path_buf();
        let plan = read_json(plan_path)?;
        let local =
            PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("local_data_unavailable")?);
        let roaming = PathBuf::from(std::env::var_os("APPDATA").ok_or("roaming_data_unavailable")?);
        let cache = local.join("com.daybridge.widget/updates");
        let install = local.join("Programs/Daybridge");
        let name = root
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or("invalid_cache")?;
        if root.parent() != Some(cache.as_path())
            || !name
                .strip_prefix("update-")
                .is_some_and(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()))
            || plan_path.file_name().and_then(|v| v.to_str()) != Some("plan.json")
        {
            return Err("unexpected_cache".into());
        }
        no_link(&cache)?;
        no_link(&root)?;
        if path(&plan, "install")? != install
            || path(&plan, "pointer")? != local.join("Daybridge/storage-location.json")
            || path(&plan, "memoState")? != local.join("com.daybridge.widget/memos/state.json")
            || path(&plan, "marker")? != roaming.join("com.daybridge.widget/explicit-exit.flag")
        {
            return Err("unexpected_paths".into());
        }
        if std::env::current_exe().map_err(fail)? != root.join("guard.exe") {
            return Err("unexpected_guard_identity".into());
        }
        let package = fs::read(root.join("update.exe")).map_err(fail)?;
        verify_package(&package, text(&plan, "signature")?)?;
        let parent_id = plan["oldPid"]
            .as_u64()
            .filter(|id| *id <= u32::MAX as u64)
            .ok_or("invalid_parent")? as u32;
        let parent = Process::open(parent_id)?;
        if parent.name()? != install.join("daybridge.exe")
            || parent.ticks()? != text(&plan, "oldStartTicks")?
        {
            return Err("parent_identity_changed".into());
        }
        let bridges = owned_bridges(parent_id, &install)?;
        if bridges.len() != 1 {
            return Err("old_bridge_identity_changed".into());
        }
        let mut host = NativeHost {
            parent,
            old_bridges: bridges,
            new_app: None,
            setup: None,
            install,
            root: root.clone(),
        };
        transaction(&root, &plan, &mut host)
    }
}
pub fn run_if_requested(args: &[std::ffi::OsString]) -> Option<Result<()>> {
    if args.first().and_then(|s| s.to_str()) == Some("--verify-update-signature") {
        return Some((|| {
            if args.len() != 3 {
                return Err("invalid_verify_arguments".into());
            }
            verify_package(
                &fs::read(Path::new(&args[1])).map_err(fail)?,
                &fs::read_to_string(Path::new(&args[2])).map_err(fail)?,
            )
        })());
    }
    if args.first().and_then(|s| s.to_str()) != Some("--apply-update") {
        return None;
    }
    if args.len() != 2 {
        return Some(Err("invalid_update_arguments".into()));
    }
    #[cfg(windows)]
    {
        Some(native::run(Path::new(&args[1])))
    }
    #[cfg(not(windows))]
    {
        Some(Err("unsupported_platform".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct FakeHost {
        package_fails: bool,
        start_fails: bool,
        installed: bool,
        started: bool,
        restored: bool,
        parent_alive: bool,
    }
    impl Host for FakeHost {
        fn parent_running(&self) -> bool {
            self.parent_alive
        }
        fn wait_parent(&mut self, _: &Path) -> Result<()> {
            self.parent_alive = false;
            Ok(())
        }
        fn stop_old_bridge(&mut self) -> Result<()> {
            Ok(())
        }
        fn install(&mut self, package: &Path, install: &Path) -> Result<()> {
            self.installed = true;
            fs::copy(package, install.join("daybridge.exe")).unwrap();
            if self.package_fails {
                Err("installer_failed".into())
            } else {
                Ok(())
            }
        }
        fn launch_and_verify(&mut self, _: &Path, _: &Value) -> Result<()> {
            self.started = true;
            if self.start_fails {
                Err("new_app_exited".into())
            } else {
                Ok(())
            }
        }
        fn stop_new(&mut self, _: &Value) -> Result<()> {
            Ok(())
        }
        fn restore_launch(&mut self, _: &Value) -> Result<()> {
            self.restored = true;
            Ok(())
        }
    }
    #[test]
    fn install_and_readiness_failures_restore_only_program_files() {
        for case in 0..4 {
            let fixture = std::env::temp_dir().join(format!(
                "daybridge-update-transaction-{}-{case}",
                std::process::id()
            ));
            let root = fixture.join("update");
            fs::create_dir_all(root.join("installed/bridge-runtime")).unwrap();
            fs::create_dir_all(root.join("memos/archive")).unwrap();
            let install = root.join("installed");
            let exe = install.join("daybridge.exe");
            fs::write(&exe, b"original executable").unwrap();
            fs::write(install.join("bridge-runtime/node.exe"), b"original runtime").unwrap();
            let memo = root.join("memos/state.json");
            fs::write(
                &memo,
                b"{\"schemaVersion\":1,\"active\":null,\"pendingArchive\":null}",
            )
            .unwrap();
            fs::write(
                root.join("memos/archive/note.md"),
                "preserve Korean memo: 한글",
            )
            .unwrap();
            let pointer = root.join("pointer.json");
            fs::write(&pointer, b"unchanged data location").unwrap();
            fs::write(root.join("update.exe"), b"new executable").unwrap();
            let plan = json!({"version":"0.2.99","install":install,"oldHash":hash(&exe).unwrap(),"installerHash":hash(&root.join("update.exe")).unwrap(),"pointer":pointer,"pointerHash":hash(&pointer).unwrap(),"memoState":memo});
            let memos = inventory(&root.join("memos")).unwrap();
            let pointer_hash = hash(&pointer).unwrap();
            let mut host = FakeHost {
                package_fails: case == 1,
                start_fails: case == 2,
                installed: false,
                started: false,
                restored: false,
                parent_alive: true,
            };
            if case == 3 {
                fs::write(root.join("update.exe"), b"tampered").unwrap();
            }
            let result = transaction(&root, &plan, &mut host);
            assert_eq!(result.is_ok(), case == 0);
            if case == 1 || case == 2 {
                assert!(host.restored);
                assert_eq!(hash(&exe).unwrap(), text(&plan, "oldHash").unwrap());
                assert_eq!(
                    read_json(&root.join("result.json")).unwrap()["phase"],
                    "rolled_back"
                );
            }
            if case == 3 {
                assert!(!host.installed);
                assert!(!host.restored);
            }
            assert_eq!(inventory(&root.join("memos")).unwrap(), memos);
            assert_eq!(hash(&pointer).unwrap(), pointer_hash);
            fs::remove_dir_all(&fixture).unwrap();
        }
    }
    #[test]
    fn invalid_signatures_are_never_accepted() {
        assert!(verify_package(b"not signed", "invalid").is_err());
    }
    #[cfg(windows)]
    #[test]
    fn process_identity_uses_live_path_and_creation_time() {
        let process = native::Process::open(std::process::id()).unwrap();
        assert_eq!(process.name().unwrap(), std::env::current_exe().unwrap());
        assert!(process.running());
        assert!(process.ticks().unwrap().parse::<u64>().unwrap() > 0);
    }
}
