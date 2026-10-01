import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
import {prepareTauriBridgeRuntime} from "./package-bridge.mjs";

const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run this build through pnpm build:widget");
const root = fileURLToPath(new URL("../", import.meta.url));
await prepareTauriBridgeRuntime({nodeExecutable: process.execPath});
const result = spawnSync(process.execPath, [pnpm, "exec", "tauri", "build", "--config", "src-tauri/tauri.release.conf.json", ...process.argv.slice(2)], {
  cwd: root, stdio: "inherit", env: {...process.env, CARGO_TARGET_DIR: join(root, "src-tauri/target/package")},
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
