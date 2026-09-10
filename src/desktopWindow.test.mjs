import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { nearestOverlayCorner, overlayInteractionRegion } from "./desktopWindow.js";

const monitor = {
  workArea: {
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
  },
};
const size = { width: 252, height: 52 };

test("nearestOverlayCorner magnetically snaps a nearby position to the closest corner", () => {
  assert.deepEqual(nearestOverlayCorner({ x: 1644, y: 980 }, monitor, size), { x: 1668, y: 1028 });
});

test("nearestOverlayCorner keeps a deliberately central position free", () => {
  assert.deepEqual(nearestOverlayCorner({ x: 800, y: 460 }, monitor, size), { x: 800, y: 460 });
});

test("overlay interaction region keeps the native canvas fixed while the compact card owns only its visible pixels", () => {
  assert.deepEqual(overlayInteractionRegion({ height: 64 }), {
    x: 232,
    y: 556,
    width: 288,
    height: 64,
  });
  assert.deepEqual(overlayInteractionRegion({ height: 364 }), {
    x: 232,
    y: 256,
    width: 288,
    height: 364,
  });
});

test("overlay interaction region gives the centered settings modal its compact viewport", () => {
  assert.deepEqual(overlayInteractionRegion({ settingsOpen: true }), {
    x: 0,
    y: 0,
    width: 456,
    height: 500,
  });
});

test("a packaged restart replaces its own local bridge instead of reusing an older listener", async () => {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const source = await readFile(resolve(root, "src-tauri", "src", "main.rs"), "utf8");
  assert.match(source, /fn stop_existing_local_bridge\(/);
  assert.match(source, /bridge_autostart_replacing_existing/);
  assert.match(source, /stop_existing_local_bridge\(&app, &script\)/);
});
