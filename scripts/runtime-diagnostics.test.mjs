import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startFixtureBridge } from "./test-support/fixture-bridge.mjs";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { once } from "node:events";
import { inspectRuntime } from "./inspect-runtime.mjs";

async function serve(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("health identifies a specific Daybridge instance and notices live pointer drift without applying it", async () => {
  const f = await startFixtureBridge();
  try {
    const first = await f.request("GET", "/api/health");
    assert.equal(first.body.service, "daybridge");
    assert.equal(first.body.schemaVersion, 1);
    assert.ok(first.body.bridgeVersion);
    assert.ok(first.body.instanceId);
    assert.ok(Number.isFinite(Date.parse(first.body.startedAt)));
    assert.equal(first.body.dataLocationSource, "environment");
    const pointer = join(f.appDataDir, "Daybridge", "storage-location.json");
    await mkdir(join(f.appDataDir, "Daybridge"), { recursive: true });
    const text = JSON.stringify({ dataDirectory: join(f.appDataDir, "other-data") });
    await writeFile(pointer, text);
    const second = await f.request("GET", "/api/health");
    assert.equal(second.body.dataDir, f.dataDir);
    assert.equal(second.body.instanceId, first.body.instanceId);
    assert.ok(second.body.configurationMismatch.codes.includes("pointer_runtime_mismatch"));
    assert.equal(await readFile(pointer, "utf8"), text);
  } finally { await f.close(); }
});

test("inspector rejects foreign HTTP identities and oversized responses without echoing their content", async () => {
  let body = { status: "ok" };
  const server = createServer((_request, response) => response.end(JSON.stringify(body)));
  const baseUrl = await serve(server);
  try {
    assert.deepEqual(await inspectRuntime({ baseUrl }), { state: "foreign_listener", identityVerified: false });
    body = { service: "daybridge", schemaVersion: 2 };
    assert.equal((await inspectRuntime({ baseUrl })).state, "incompatible_bridge");
    body = { status: "ok", dataDir: "fixture private path" };
    const legacy = await inspectRuntime({ baseUrl });
    assert.equal(legacy.state, "legacy_bridge");
    assert.ok(!JSON.stringify(legacy).includes("private path"));
    body = { service: "daybridge", schemaVersion: 1, status: "ok", bridgeVersion: "0.1.0+0123456789ab", instanceId: "12345678-1234-1234-1234-123456789abc", startedAt: "2099-01-05T00:00:00.000Z",
      dataLocationSource: "fixture private content", profile: { state: "fixture private content" }, configurationMismatch: { codes: ["fixture_private_content"] },
      handoffState: { state: "fixture private content", pending: "fixture private content", failed: "fixture private content", checkedAt: "fixture private content" } };
    const bounded = await inspectRuntime({ baseUrl });
    assert.equal(bounded.identityVerified, true);
    assert.equal(bounded.state, "unknown");
    assert.ok(!JSON.stringify(bounded).includes("fixture private content"));
    body = { secret: "fixture oversized content ".repeat(2000) };
    assert.equal((await inspectRuntime({ baseUrl })).state, "foreign_listener");
  } finally { await closeServer(server); }
  assert.equal((await inspectRuntime({ baseUrl })).state, "unavailable");
  await assert.rejects(() => inspectRuntime({ baseUrl: "http://untrusted.example" }), TypeError);
});

test("a live TCP server that never speaks HTTP fails identity verification within the deadline", async () => {
  const sockets = new Set();
  const server = createTcpServer(socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  const baseUrl = await serve(server);
  try {
    const started = Date.now();
    assert.equal((await inspectRuntime({ baseUrl, timeoutMs: 150 })).state, "foreign_listener");
    assert.ok(Date.now() - started < 1500);
  } finally { for (const socket of sockets) socket.destroy(); await closeServer(server); }
});

test("profile verification, sink configuration and actual successful delivery remain distinct", async () => {
  const f = await startFixtureBridge();
  try {
    const initial = (await f.request("GET", "/api/health")).body;
    assert.equal(initial.profile.state, "missing");
    assert.equal(initial.handoffState.state, "sink_unconfigured");
    const maruRoot = join(f.appDataDir, "fixture-maru");
    const profilePath = join(f.appDataDir, "MARU", "environment.json");
    for (const directory of [join(f.appDataDir, "MARU"), join(maruRoot, "00_Index"), join(maruRoot, "04_Operations_And_Automation")]) await mkdir(directory, { recursive: true });
    await writeFile(join(maruRoot, "AGENTS.md"), "fixture marker");
    const text = JSON.stringify({ maru_root: maruRoot, daybridge_root: initial.sourceRoot, unrelatedPrivateField: "fixture private content" });
    await writeFile(profilePath, text);
    let health = (await f.request("GET", "/api/health")).body;
    assert.equal(health.profile.state, "confirmed");
    assert.equal(health.configurationMismatch.detected, false);
    await writeFile(join(f.dataDir, "config.json"), "{}");
    health = (await f.request("GET", "/api/health")).body;
    assert.equal(health.handoffState.state, "ready");
    assert.equal(health.handoffState.deliveryVerified, false);
    const created = await f.request("POST", "/api/quests/manual", { activityDate: "2099-01-05", title: "fixture delivery" });
    assert.equal(created.status, 201);
    assert.equal(created.body.handoff.state, "sent");
    const inspected = await inspectRuntime({ baseUrl: f.baseUrl, profilePath });
    assert.equal(inspected.state, "connected");
    assert.equal(inspected.handoffState.deliveryVerified, true);
    const printed = JSON.stringify(inspected);
    for (const privateValue of [f.dataDir, f.appDataDir, maruRoot, "fixture private content"]) assert.ok(!printed.includes(privateValue));
    assert.equal(await readFile(profilePath, "utf8"), text);
    await writeFile(profilePath, JSON.stringify({ maru_root: maruRoot, daybridge_root: join(f.appDataDir, "other-checkout") }));
    assert.equal((await inspectRuntime({ baseUrl: f.baseUrl, profilePath })).state, "configuration_mismatch");
  } finally { await f.close(); }
});

test("a failed handoff is diagnosed without retrying or changing the sink during inspection", async () => {
  const f = await startFixtureBridge();
  try {
    const sink = join(f.appDataDir, "blocked-sink");
    await writeFile(sink, "fixture preserved obstruction");
    await writeFile(join(f.dataDir, "config.json"), JSON.stringify({ handoffSinkDir: sink }));
    const created = await f.request("POST", "/api/quests/manual", { activityDate: "2099-01-05", title: "fixture blocked delivery" });
    assert.equal(created.status, 201);
    assert.equal(created.body.handoff.failed, 1);
    const inspected = await inspectRuntime({ baseUrl: f.baseUrl });
    assert.equal(inspected.state, "delivery_failed");
    assert.equal(inspected.handoffState.deliveryVerified, false);
    assert.equal(await readFile(sink, "utf8"), "fixture preserved obstruction");
    assert.equal(inspected.handoffState.pending, 1);
  } finally { await f.close(); }
});

test("damaged pointer and profile are preserved and diagnostics do not repair them", async () => {
  const f = await startFixtureBridge();
  try {
    const pointer = join(f.appDataDir, "Daybridge", "storage-location.json");
    const profilePath = join(f.appDataDir, "MARU", "environment.json");
    await mkdir(join(f.appDataDir, "Daybridge"), { recursive: true });
    await mkdir(join(f.appDataDir, "MARU"), { recursive: true });
    await writeFile(pointer, "{damaged pointer");
    await writeFile(profilePath, "{damaged profile");
    const result = await inspectRuntime({ baseUrl: f.baseUrl, profilePath });
    assert.equal(result.identityVerified, true);
    assert.equal(result.state, "configuration_attention");
    assert.ok(result.configurationMismatch.codes.includes("pointer_unreadable"));
    assert.equal(result.profile.state, "invalid");
    assert.equal(await readFile(pointer, "utf8"), "{damaged pointer");
    assert.equal(await readFile(profilePath, "utf8"), "{damaged profile");
  } finally { await f.close(); }
});

test("a fixture restart changes instance identity and keeps the same source version", async () => {
  const f = await startFixtureBridge();
  try {
    const first = await inspectRuntime({ baseUrl: f.baseUrl });
    await f.restart();
    const second = await inspectRuntime({ baseUrl: f.baseUrl });
    assert.equal(second.identityVerified, true);
    assert.notEqual(second.instanceId, first.instanceId);
    assert.equal(second.bridgeVersion, first.bridgeVersion);
  } finally { await f.close(); }
});

test("unconfirmed profile, explicitly disabled sink and broken configuration have separate states", async () => {
  const f = await startFixtureBridge();
  try {
    const path = join(f.dataDir, "config.json");
    await writeFile(path, "{}");
    assert.equal((await inspectRuntime({ baseUrl: f.baseUrl })).state, "profile_unconfirmed");
    for (const handoffSinkDir of [null, "", "   "]) {
      const text = JSON.stringify({ handoffSinkDir });
      await writeFile(path, text);
      assert.equal((await inspectRuntime({ baseUrl: f.baseUrl })).state, "sink_unconfigured");
      assert.equal(await readFile(path, "utf8"), text);
    }
    await writeFile(path, "{broken configuration");
    const result = await inspectRuntime({ baseUrl: f.baseUrl });
    assert.equal(result.identityVerified, true);
    assert.equal(result.state, "configuration_attention");
    assert.equal(result.handoffState.state, "configuration_invalid");
    assert.ok(result.configurationMismatch.codes.includes("config_invalid"));
    assert.equal(await readFile(path, "utf8"), "{broken configuration");
  } finally { await f.close(); }
});
