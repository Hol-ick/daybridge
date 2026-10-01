import assert from "node:assert/strict";
import test from "node:test";
import { createBridgeClient, savedNotice } from "../src/bridge-client.js";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { startFixtureBridge } from "./test-support/fixture-bridge.mjs";

test("network retry retains ID and payload and consumes a broken response stream", async () => {
  const calls = [];
  let recoveries = 0;
  const request = createBridgeClient({ recoverBridge: async () => recoveries++, fetchImpl: async (_, options) => {
    calls.push(options);
    if (calls.length === 1) return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("lost response")); } }));
    return Response.json({ saved: true });
  } });
  assert.deepEqual(await (await request("/api/quests/manual", { method: "POST", requestId: "retry-001", body: { title: "fixture" } })).json(), { saved: true });
  assert.equal(calls.length, 2);
  assert.equal(recoveries, 1);
  assert.equal(calls[0].headers.get("X-Request-Id"), "retry-001");
  assert.equal(calls[1].headers.get("X-Request-Id"), "retry-001");
  assert.equal(calls[0].body, calls[1].body);
});

test("actual HTTP response loss retries the committed mutation without another quest or event", async () => {
  const date = "2099-01-02";
  const f = await startFixtureBridge({ initialFiles: {
    [`boards/${date}.json`]: JSON.stringify({ schemaVersion: 2, activityDate: date, quests: [], sourceWarnings: [] }),
    "schedule-settings.json": JSON.stringify({ timeConfigured: false }),
  } });
  let calls = 0;
  const proxy = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch(f.baseUrl + request.url, { method: request.method, headers: { "Content-Type": "application/json", "X-Request-Id": request.headers["x-request-id"] }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(5000) });
      const body = await upstream.text();
      if (++calls === 1) { response.destroy(); return; }
      response.writeHead(upstream.status, { "Content-Type": "application/json" });
      response.end(body);
    } catch { response.writeHead(502); response.end(); }
  });
  try {
    await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
    const request = createBridgeClient({ baseUrl: `http://127.0.0.1:${proxy.address().port}` });
    const response = await request("/api/quests/manual", { method: "POST", requestId: "real-response-loss", body: { activityDate: date, title: "fixture socket loss" } });
    assert.equal(response.status, 201);
    assert.equal(calls, 2);
    assert.equal((JSON.parse(await readFile(join(f.dataDir, "boards", `${date}.json`), "utf8"))).quests.length, 1);
    assert.equal((await readdir(join(f.dataDir, "events", date))).length, 1);
  } finally {
    proxy.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve));
    await f.close();
  }
});

test("legacy mutations, unsafe diagnostics, HTTP errors and explicit cancellation are not retried", async () => {
  for (const options of [{ method: "POST" }, { method: "POST", requestId: "id", path: "/api/calendar/connect" }]) {
    let calls = 0;
    const request = createBridgeClient({ fetchImpl: async () => { calls++; throw new TypeError("offline"); } });
    await assert.rejects(request(options.path || "/api/quests/manual", options));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const rejected = createBridgeClient({ fetchImpl: async () => { calls++; return Response.json({ code: "conflict" }, { status: 409 }); } });
  assert.equal((await rejected("/api/report", { method: "POST", requestId: "id" })).status, 409);
  assert.equal(calls, 1);
  const controller = new AbortController();
  const cancelled = createBridgeClient({ fetchImpl: async () => { controller.abort(); throw controller.signal.reason; } });
  await assert.rejects(cancelled("/api/board", { signal: controller.signal }), e => e.name === "AbortError");
});

test("timeouts and recovery are bounded and cancellation during recovery prevents replay", async () => {
  let calls = 0;
  const timeout = createBridgeClient({ timeoutMs: 15, fetchImpl: async () => { calls++; return await new Promise(() => {}); } });
  await assert.rejects(timeout("/api/board"), e => e.name === "TimeoutError");
  assert.equal(calls, 2);
  const controller = new AbortController();
  calls = 0;
  const request = createBridgeClient({ fetchImpl: async () => { calls++; throw new TypeError("offline"); }, recoverBridge: async () => { controller.abort(); } });
  await assert.rejects(request("/api/board", { signal: controller.signal }), e => e.name === "AbortError");
  assert.equal(calls, 1);
  assert.match(savedNotice("저장했어요", { handoff: { state: "pending" } }), /로컬 저장 완료/);
});
