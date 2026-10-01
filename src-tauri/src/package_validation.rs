use crate::{bridge_health, bridge_runtime};
use serde_json::json;
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[cfg(windows)]
struct OwnedJob(windows::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl OwnedJob {
    fn new() -> Result<Self, String> {
        use windows::Win32::System::JobObjects::*;
        let job = Self(
            unsafe { CreateJobObjectW(None, windows::core::PCWSTR::null()) }
                .map_err(|e| e.to_string())?,
        );
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as _,
                std::mem::size_of_val(&limits) as u32,
            )
        }
        .map_err(|e| e.to_string())?;
        Ok(job)
    }
    fn assign(&self, child: &Child) -> Result<(), String> {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            windows::Win32::System::JobObjects::AssignProcessToJobObject(
                self.0,
                windows::Win32::Foundation::HANDLE(child.as_raw_handle()),
            )
        }
        .map_err(|e| e.to_string())
    }
}
#[cfg(windows)]
impl Drop for OwnedJob {
    fn drop(&mut self) {
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.0) };
    }
}

struct OwnedBridge {
    child: Child,
    #[cfg(windows)]
    _job: OwnedJob,
}
impl OwnedBridge {
    fn stop(&mut self) -> Result<(), String> {
        if self.child.try_wait().map_err(|e| e.to_string())?.is_none() {
            self.child.kill().map_err(|e| e.to_string())?;
        }
        self.child.wait().map_err(|e| e.to_string())?;
        Ok(())
    }
}
impl Drop for OwnedBridge {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn fixture_path(value: &Path) -> Result<PathBuf, String> {
    let temp = std::env::temp_dir()
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let parent = value
        .parent()
        .ok_or("Validation fixture requires an absolute path")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !value.is_absolute()
        || parent != temp
        || !value
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|v| v.starts_with("daybridge-package-validation-"))
    {
        return Err(
            "Validation fixture must be a new direct child of the temporary directory".into(),
        );
    }
    Ok(bridge_runtime::node_path(
        &parent.join(value.file_name().unwrap()),
    ))
}

fn port_from_line(line: &str) -> Option<u16> {
    line.strip_prefix("Daybridge local bridge listening on http://127.0.0.1:")?
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)
}

fn launch(
    runtime: &bridge_runtime::BridgeRuntime,
    root: &Path,
) -> Result<(OwnedBridge, u16), String> {
    #[cfg(windows)]
    let job = OwnedJob::new()?;
    let mut command = Command::new(&runtime.node);
    command
        .arg(&runtime.script)
        .current_dir(&runtime.working_directory)
        .env_clear()
        .env("PATH", "")
        .env("LOCALAPPDATA", root.join("appdata"))
        .env("DAYBRIDGE_DATA_DIR", root.join("data"))
        .env("DAYBRIDGE_BRIDGE_PORT", "0")
        .env("DAYBRIDGE_PACKAGE_VALIDATION", "1")
        .env("MARU_ENV_PROFILE", root.join("missing-profile.json"))
        .env("TEMP", root)
        .env("TMP", root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(fs::File::create(root.join("bridge-stderr.txt")).map_err(|e| e.to_string())?);
    if let Some(value) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if let Err(error) = job.assign(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    let output = child.stdout.take().ok_or("Validation stdout unavailable")?;
    let mut bridge = OwnedBridge {
        child,
        #[cfg(windows)]
        _job: job,
    };
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(output.take(8192)).lines() {
            match line {
                Ok(line) => {
                    if let Some(port) = port_from_line(&line) {
                        let _ = sender.send(port);
                        return;
                    }
                }
                Err(_) => return,
            }
        }
    });
    let port = receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Validation bridge startup failed or timed out".to_string())?;
    let endpoint = SocketAddr::from(([127, 0, 0, 1], port));
    if !bridge_health::bridge_is_reachable_at(endpoint) {
        bridge.stop()?;
        return Err("Validation health identity failed".into());
    }
    Ok((bridge, port))
}

fn ready(root: &Path, bridge: &OwnedBridge, port: u16, generation: u32) -> Result<(), String> {
    let record = json!({"schemaVersion": 1, "mode": "daybridge-package-validation-v1", "state": "ready", "generation": generation, "bridgePid": bridge.child.id(), "port": port, "runtimeSource": "Bundled", "startupEnabled": false, "keepAliveEnabled": false});
    // Separate generations avoid readers observing a partially replaced readiness file.
    fs::write(
        root.join(format!("ready-{generation}.json")),
        serde_json::to_vec(&record).unwrap(),
    )
    .map_err(|e| e.to_string())
}

fn run(root: &Path, token: &str) -> Result<(), String> {
    if token.len() != 32 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Validation ownership token is invalid".into());
    }
    let root = fixture_path(root)?;
    // Windows Tauri resource_dir is the executable's parent directory.
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let resources = executable
        .parent()
        .ok_or("Validation executable has no parent")?;
    let runtime = bridge_runtime::resolve_bridge_runtime(resources, false)?;
    fs::create_dir(&root)
        .map_err(|_| "Validation fixture already exists or cannot be created".to_string())?;
    fs::write(
        root.join("validation-owner.json"),
        serde_json::to_vec(&json!({"token": token})).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    fs::create_dir(root.join("data")).map_err(|e| e.to_string())?;
    fs::create_dir(root.join("appdata")).map_err(|e| e.to_string())?;
    fs::write(root.join("data/config.json"), b"{\"handoffSinkDir\":null}")
        .map_err(|e| e.to_string())?;
    let (mut bridge, mut port) = launch(&runtime, &root)?;
    let mut generation = 1;
    ready(&root, &bridge, port, generation)?;
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut stopped_by_request = false;
    while Instant::now() < deadline {
        if root.join("stop-request").is_file() {
            stopped_by_request = true;
            break;
        }
        if generation == 1 && root.join("restart-request").is_file() {
            bridge.stop()?;
            (bridge, port) = launch(&runtime, &root)?;
            generation = 2;
            ready(&root, &bridge, port, generation)?;
        }
        if bridge
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Err("Validation bridge exited unexpectedly".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    bridge.stop()?;
    let record = json!({"schemaVersion": 1, "state": "stopped", "reason": if stopped_by_request { "requested" } else { "lease_expired" }, "generation": generation, "bridgeStopped": true, "startupEnabled": false, "keepAliveEnabled": false});
    fs::write(
        root.join("validation-result.json"),
        serde_json::to_vec(&record).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Executed before Tauri initialization, Windows startup registration or watchdogs.
pub fn run_if_requested(args: &[OsString]) -> Option<Result<(), String>> {
    if !args.iter().any(|value| value == "--validate-package") {
        return None;
    }
    if args.len() != 3 || args[0] != "--validate-package" {
        return Some(Err(
            "Usage: --validate-package <new-temp-fixture> <ownership-token>".into(),
        ));
    }
    let Some(token) = args[2].to_str() else {
        return Some(Err("Validation ownership token is invalid".into()));
    };
    Some(run(Path::new(&args[1]), token))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validation_arguments_fail_before_app_startup() {
        assert!(run_if_requested(&[]).is_none());
        assert!(run_if_requested(&["--validate-package".into()])
            .unwrap()
            .is_err());
        assert!(
            run_if_requested(&["other".into(), "--validate-package".into()])
                .unwrap()
                .is_err()
        );
    }
    #[test]
    fn startup_port_requires_the_exact_bridge_banner_and_a_real_port() {
        assert_eq!(
            port_from_line("Daybridge local bridge listening on http://127.0.0.1:12345"),
            Some(12345)
        );
        assert_eq!(
            port_from_line("Daybridge local bridge listening on http://127.0.0.1:0"),
            None
        );
        assert_eq!(port_from_line("foreign http://127.0.0.1:12345"), None);
    }
    #[test]
    fn validation_fixture_cannot_select_an_existing_project_directory() {
        assert!(fixture_path(Path::new(env!("CARGO_MANIFEST_DIR"))).is_err());
        assert!(fixture_path(Path::new("relative")).is_err());
    }
}
