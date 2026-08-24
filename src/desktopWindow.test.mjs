import test from "node:test";
import assert from "node:assert/strict";

import { nearestOverlayCorner } from "./desktopWindow.js";

const monitor = {
  workArea: {
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
  },
};
const size = { width: 252, height: 52 };

test("nearestOverlayCorner magnetically snaps a nearby position to the closest corner", () => {
  assert.deepEqual(nearestOverlayCorner({ x: 1640, y: 970 }, monitor, size), { x: 1660, y: 1020 });
});

test("nearestOverlayCorner keeps a deliberately central position free", () => {
  assert.deepEqual(nearestOverlayCorner({ x: 800, y: 460 }, monitor, size), { x: 800, y: 460 });
});
