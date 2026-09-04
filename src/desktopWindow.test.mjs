import test from "node:test";
import assert from "node:assert/strict";

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

test("overlay interaction region gives the centered settings modal the entire fixed canvas", () => {
  assert.deepEqual(overlayInteractionRegion({ settingsOpen: true }), {
    x: 0,
    y: 0,
    width: 520,
    height: 620,
  });
});
