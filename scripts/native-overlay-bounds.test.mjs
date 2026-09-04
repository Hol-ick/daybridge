import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeMain = fs.readFileSync(path.join(root, "src-tauri", "src", "main.rs"), "utf8");
const boundsCommand = nativeMain.match(/fn set_overlay_bounds\([\s\S]*?\n}\n\n#\[tauri::command\]\nfn record_runtime_event/);

test("overlay bounds update changes geometry without forcing a new show or z-order", () => {
  assert.ok(boundsCommand, "set_overlay_bounds command should exist");
  assert.doesNotMatch(boundsCommand[0], /HWND_TOPMOST/);
  assert.doesNotMatch(boundsCommand[0], /SWP_SHOWWINDOW/);
  assert.match(boundsCommand[0], /SWP_NOZORDER/);
});
