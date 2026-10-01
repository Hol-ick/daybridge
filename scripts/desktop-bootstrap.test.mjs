import assert from "node:assert/strict";
import test from "node:test";
import { mountAfterBridgeReady } from "../src/desktop-bootstrap.js";

test("desktop mounts only after its queued native bridge initialization finishes", async () => {
  let ready;
  const native = new Promise(resolve => { ready = resolve; });
  const events = [];
  let mounted = 0;
  const boot = mountAfterBridgeReady({ desktop: true, ensureBridge: () => native,
    mount: () => { mounted++; assert.equal(events[0], "webview_bridge_startup_ready"); },
    report: event => events.push(event) });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(mounted, 0, "Requests must not begin while the native setup is still queued");
  ready(false); // An already running, healthy bridge also permits rendering.
  await boot;
  assert.equal(mounted, 1);
});

test("browser mounts without trying to create a native bridge", async () => {
  let mounted = 0;
  await mountAfterBridgeReady({ desktop: false,
    ensureBridge: () => { throw new Error("Browser must not invoke native commands"); },
    mount: () => mounted++, report: () => assert.fail("No desktop readiness event in a browser") });
  assert.equal(mounted, 1);
});

test("native rejection renders the existing error-capable UI and records failure", async () => {
  const events = [];
  let mounted = 0;
  await mountAfterBridgeReady({ desktop: true, ensureBridge: async () => { throw new Error("foreign listener"); },
    mount: () => mounted++, report: (event, details) => events.push({ event, details }) });
  assert.equal(mounted, 1);
  assert.equal(events[0].event, "webview_bridge_startup_failed");
  assert.equal(events[0].details.error, "foreign listener");
});

test("a stalled bootstrap is bounded and late readiness cannot mount twice", async () => {
  let ready;
  let mounted = 0;
  const events = [];
  const native = new Promise(resolve => { ready = resolve; });
  await mountAfterBridgeReady({ desktop: true, ensureBridge: () => native, timeoutMs: 20,
    mount: () => mounted++, report: event => events.push(event) });
  assert.equal(mounted, 1);
  assert.deepEqual(events, ["webview_bridge_startup_failed"]);
  ready(true);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(mounted, 1);
});
