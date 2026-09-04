import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeMain = fs.readFileSync(path.join(root, "src-tauri", "src", "main.rs"), "utf8");
const regionCommand = nativeMain.match(/fn set_overlay_interaction_region\([\s\S]*?\n}\n\n#\[tauri::command\]\nfn record_runtime_event/);
const overlaySurface = fs.readFileSync(path.join(root, "src", "schedule", "NowFocusOverlay.jsx"), "utf8");

test("overlay interaction changes do not force a new show, z-order, or native resize", () => {
  assert.ok(regionCommand, "set_overlay_interaction_region command should exist");
  assert.doesNotMatch(regionCommand[0], /HWND_TOPMOST/);
  assert.doesNotMatch(regionCommand[0], /SWP_SHOWWINDOW/);
  assert.doesNotMatch(regionCommand[0], /SetWindowPos/);
});

test("opening and closing the schedule use a native interaction region instead of resizing the transparent WebView", () => {
  assert.match(nativeMain, /fn set_overlay_interaction_region\(/);
  assert.doesNotMatch(nativeMain, /fn set_overlay_bounds\(/);
  assert.match(overlaySurface, /setOverlayInteractionRegion/);
  assert.doesNotMatch(overlaySurface, /resizeOverlay/);
});
