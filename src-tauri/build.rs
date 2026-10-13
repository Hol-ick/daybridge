fn main() {
    let revision = std::process::Command::new("git").args(["rev-parse", "HEAD"]).output()
        .ok().filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_else(|| "unknown".to_owned());
    println!("cargo:rustc-env=DAYBRIDGE_BUILD_REVISION={revision}");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs/heads/main");
    tauri_build::build()
}
