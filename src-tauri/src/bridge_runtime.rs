use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeSource {
    Bundled,
    Development,
}

#[derive(Debug)]
pub struct BridgeRuntime {
    pub source: RuntimeSource,
    pub node: PathBuf,
    pub script: PathBuf,
    pub working_directory: PathBuf,
}

fn check_file(root: &Path, name: &str, record: &serde_json::Value) -> Result<(), String> {
    let mut file =
        File::open(root.join(name)).map_err(|_| format!("패키지 실행 파일이 없습니다: {name}"))?;
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| format!("패키지 실행 파일을 읽을 수 없습니다: {name}"))?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
        total += count as u64;
    }
    let expected = record["sha256"].as_str().unwrap_or("");
    if record["bytes"].as_u64() != Some(total) || expected != format!("{:x}", hash.finalize()) {
        return Err(format!(
            "패키지 실행 파일의 무결성을 확인하지 못했습니다: {name}"
        ));
    }
    Ok(())
}

fn resolve_with_development(
    resources: &Path,
    development_root: Option<&Path>,
) -> Result<BridgeRuntime, String> {
    let root = resources.join("bridge-runtime");
    // A partial or damaged installed runtime must never silently use a checkout.
    if root.exists() {
        let bytes = std::fs::read(root.join("runtime-manifest.json"))
            .map_err(|_| "패키지 실행 정보가 없습니다.".to_string())?;
        let manifest: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| "패키지 실행 정보가 손상되었습니다.".to_string())?;
        if manifest["schemaVersion"] != 1
            || manifest["applicationVersion"] != env!("CARGO_PKG_VERSION")
            || manifest["node"]["version"] != "v24.19.0"
            || manifest["node"]["platform"] != "win32"
            || manifest["node"]["arch"] != "x64"
        {
            return Err("패키지 실행 환경의 버전이나 플랫폼이 호환되지 않습니다.".to_string());
        }
        for name in [
            "node.exe",
            "package.json",
            "scripts/local-bridge.mjs",
            "THIRD_PARTY_NOTICES.txt",
        ] {
            check_file(&root, name, &manifest["files"][name])?;
        }
        let root = root
            .canonicalize()
            .map_err(|_| "패키지 실행 경로를 확인할 수 없습니다.".to_string())?;
        return Ok(BridgeRuntime {
            source: RuntimeSource::Bundled,
            node: root.join("node.exe"),
            script: root.join("scripts/local-bridge.mjs"),
            working_directory: root,
        });
    }
    if let Some(root) = development_root {
        if root.join("scripts/local-bridge.mjs").is_file() && root.join("package.json").is_file() {
            return Ok(BridgeRuntime {
                source: RuntimeSource::Development,
                node: std::env::var_os("DAYBRIDGE_NODE")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| "node".into()),
                script: root.join("scripts/local-bridge.mjs"),
                working_directory: root.to_path_buf(),
            });
        }
    }
    Err(
        "독립 브리지 패키지를 찾을 수 없습니다. 설치 파일의 실행 리소스를 확인해 주세요."
            .to_string(),
    )
}

pub fn resolve_bridge_runtime(
    resources: &Path,
    development: bool,
) -> Result<BridgeRuntime, String> {
    // The compile-time checkout path is only available in debug builds.
    #[cfg(debug_assertions)]
    let root = if development {
        Path::new(env!("CARGO_MANIFEST_DIR")).parent()
    } else {
        None
    };
    #[cfg(not(debug_assertions))]
    let root = {
        let _ = development;
        None
    };
    resolve_with_development(resources, root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let name = format!(
                "daybridge-rust-runtime-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            );
            let root = std::env::temp_dir().join(name);
            std::fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn bundle(&self) {
            let root = self.0.join("bridge-runtime");
            std::fs::create_dir_all(root.join("scripts")).unwrap();
            let mut files = serde_json::Map::new();
            for name in [
                "node.exe",
                "package.json",
                "scripts/local-bridge.mjs",
                "THIRD_PARTY_NOTICES.txt",
            ] {
                let data = format!("isolated fixture {name}");
                std::fs::write(root.join(name), data.as_bytes()).unwrap();
                files.insert(name.to_string(), json!({"bytes": data.len(), "sha256": format!("{:x}", Sha256::digest(data.as_bytes()))}));
            }
            let manifest = json!({"schemaVersion": 1, "applicationVersion": env!("CARGO_PKG_VERSION"), "node": {"version": "v24.19.0", "platform": "win32", "arch": "x64"}, "files": files});
            std::fs::write(
                root.join("runtime-manifest.json"),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn release_selects_resources_without_checkout_or_path_node() {
        let fixture = Fixture::new();
        fixture.bundle();
        let runtime = resolve_bridge_runtime(&fixture.0, false).unwrap();
        let root = fixture.0.join("bridge-runtime").canonicalize().unwrap();
        assert_eq!(runtime.source, RuntimeSource::Bundled);
        assert_eq!(runtime.node, root.join("node.exe"));
        assert_eq!(runtime.script, root.join("scripts/local-bridge.mjs"));
        assert_eq!(runtime.working_directory, root);
    }

    #[test]
    fn release_cannot_fall_back_to_the_real_checkout() {
        let fixture = Fixture::new();
        assert!(resolve_bridge_runtime(&fixture.0, false).is_err());
        #[cfg(debug_assertions)]
        assert_eq!(
            resolve_bridge_runtime(&fixture.0, true).unwrap().source,
            RuntimeSource::Development
        );
    }

    #[test]
    fn damaged_resources_never_fall_back_to_a_valid_checkout() {
        let fixture = Fixture::new();
        fixture.bundle();
        std::fs::write(
            fixture.0.join("bridge-runtime/scripts/local-bridge.mjs"),
            "damaged",
        )
        .unwrap();
        let error = resolve_bridge_runtime(&fixture.0, true).unwrap_err();
        assert!(error.contains("무결성"));
    }

    #[test]
    fn missing_manifest_is_an_error_even_in_development() {
        let fixture = Fixture::new();
        std::fs::create_dir(fixture.0.join("bridge-runtime")).unwrap();
        assert!(resolve_bridge_runtime(&fixture.0, true)
            .unwrap_err()
            .contains("실행 정보"));
    }

    #[test]
    fn another_node_version_is_not_an_accepted_package() {
        let fixture = Fixture::new();
        fixture.bundle();
        let path = fixture.0.join("bridge-runtime/runtime-manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        manifest["node"]["version"] = json!("v22.0.0");
        std::fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(resolve_bridge_runtime(&fixture.0, false)
            .unwrap_err()
            .contains("호환"));
    }
}
