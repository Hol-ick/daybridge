import {spawnSync} from "node:child_process";
import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

export async function buildStartupLauncher(root = fileURLToPath(new URL("../", import.meta.url))) {
  if (process.platform !== "win32") return;
  const output = join(root, "src-tauri/target/package/startup-launcher.exe");
  await mkdir(join(root, "src-tauri/target/package"), {recursive: true});
  const result = spawnSync("rustc", ["--edition=2021", "-C", "opt-level=s", "-C", "strip=symbols", join(root, "scripts/startup-launcher.rs"), "-o", output], {cwd: root, stdio: "inherit", windowsHide: true});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Startup launcher build failed (${result.status})`);
  return output;
}
