import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeMain = fs.readFileSync(path.join(root, "src-tauri", "src", "main.rs"), "utf8");
const regionCommand = nativeMain.match(/fn set_overlay_interaction_region\([\s\S]*?\n}\n\n#\[tauri::command\]\nfn record_runtime_event/);
const overlaySurface = fs.readFileSync(path.join(root, "src", "schedule", "NowFocusOverlay.jsx"), "utf8");
const overlayStyles = fs.readFileSync(path.join(root, "src", "schedule", "NowFocusOverlay.module.css"), "utf8");
const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));

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

test("the full-size settings region never exposes a Windows title bar or system menu", () => {
  const overlayWindow = tauriConfig.app.windows.find((window) => window.label === "overlay");
  assert.equal(overlayWindow?.decorations, false);
  assert.match(nativeMain, /fn remove_overlay_window_chrome\(/);
  assert.match(nativeMain, /WS_CAPTION/);
  assert.match(nativeMain, /WS_SYSMENU/);
  assert.match(nativeMain, /remove_overlay_window_chrome\(app\.handle\(\), &window\)/);
  const visibleAt = nativeMain.indexOf('ensure_overlay_visible(app.handle(), "app_setup")');
  const chromeAt = nativeMain.lastIndexOf("remove_overlay_window_chrome(app.handle(), &window)");
  assert.ok(chromeAt > visibleAt, "remove native chrome after Tauri makes the overlay visible");
});

test("the centered settings dialog paints only its sheet, not a translucent canvas around it", () => {
  const modalRule = overlayStyles.match(/\.settingsModal\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const settingsModeRule = overlayStyles.match(/\.surface\.settingsMode\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(modalRule, /background:\s*transparent/);
  assert.doesNotMatch(modalRule, /backdrop-filter/);
  assert.match(settingsModeRule, /visibility:\s*hidden/);
  assert.match(settingsModeRule, /pointer-events:\s*none/);
});
