import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { startFixtureBridge } from "./test-support/fixture-bridge.mjs";
import { validateRequest } from "./bridge/request-policy.mjs";

async function stateFiles(root) {
  const files = {};
  for (const name of ["boards", "schedules", "events", "activity"]) {
    async function visit(path) {
      let entries;
      try { entries = await readdir(path, { withFileTypes: true }); }
      catch (error) { if (error.code === "ENOENT") return; throw error; }
      for (const entry of entries) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) await visit(child);
        else files[child] = await readFile(child, "utf8");
      }
    }
    await visit(join(root, name));
  }
  return files;
}

test("HTTP rejection never mutates date state and trusted callers still work", async () => {
  const f = await startFixtureBridge();
  try {
    const before = await stateFiles(f.dataDir);
    const cases = [
      { origin: "https://untrusted.example", contentType: "text/plain", body: JSON.stringify({ activityDate: "2099-01-02", title: "Rejected fixture" }), status: 403 },
      { origin: "null", contentType: "application/json", body: '{}', status: 403 },
      { origin: "http://tauri.localhost", contentType: "text/plain", body: '{}', status: 415 },
      { origin: "http://tauri.localhost", contentType: "application/json", body: '{', status: 400 },
      { origin: "http://tauri.localhost", contentType: "application/json", body: JSON.stringify({ title: "x".repeat(128 * 1024) }), status: 413 },
    ];
    for (const item of cases) {
      const response = await fetch(f.baseUrl + "/api/quests/manual", {
        method: "POST", headers: { Origin: item.origin, "Content-Type": item.contentType }, body: item.body,
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, item.status, `${item.origin}/${item.contentType}`);
      if (item.status === 403) assert.equal(response.headers.get("access-control-allow-origin"), null);
      await response.json();
      assert.deepEqual(await stateFiles(f.dataDir), before);
    }
    const options = await fetch(f.baseUrl + "/api/quests/manual", { method: "OPTIONS", headers: { Origin: "https://untrusted.example" } });
    assert.equal(options.status, 403);
    const goodOptions = await fetch(f.baseUrl + "/api/quests/manual", { method: "OPTIONS", headers: { Origin: "http://tauri.localhost" } });
    assert.equal(goodOptions.status, 204);
    assert.equal(goodOptions.headers.get("access-control-allow-origin"), "http://tauri.localhost");
    const created = await f.request("POST", "/api/quests/manual", { activityDate: "2099-01-02", title: "Trusted fixture" }, { origin: "http://tauri.localhost" });
    assert.equal(created.status, 201);
    const activity = await f.request("GET", "/api/activity?date=2099-01-02", undefined, { origin: "http://tauri.localhost" });
    assert.equal(activity.headers.get("access-control-allow-origin"), "http://tauri.localhost");
    const cli = await f.request("POST", "/api/quests/manual", { activityDate: "2099-01-02", title: "CLI fixture" });
    assert.equal(cli.status, 201);
  } finally { await f.close(); }
});

test("policy binds Host to the current loopback port and preserves supported origins", () => {
  for (const host of ["127.0.0.1:40000", "localhost:40000", "[::1]:40000"]) {
    assert.equal(validateRequest({ method: "GET", host, port: 40000 }).ok, true);
  }
  for (const host of ["example.com:40000", "127.0.0.1:39393", "127.0.0.1:40000.evil", undefined]) {
    assert.equal(validateRequest({ method: "GET", host, port: 40000 }).code, "untrusted_host");
  }
  for (const origin of ["http://localhost:5173", "http://127.0.0.1:4173", "tauri://localhost", "https://tauri.localhost", "http://tauri.localhost:1234"]) {
    assert.equal(validateRequest({ method: "POST", host: "127.0.0.1:40000", port: 40000, origin, contentType: "application/json; charset=utf-8" }).ok, true);
  }
  assert.equal(validateRequest({ method: "POST", host: "127.0.0.1:40000", port: 40000 }).status, 415);
});

test("HTTP Host rejection and chunked body limit protect fixture state", async () => {
  const f = await startFixtureBridge();
  async function raw(headers, chunks) {
    return await new Promise((resolve, reject) => {
      const request = httpRequest(f.baseUrl + "/api/quests/manual", { method: "POST", headers, timeout: 5000 }, (response) => {
        const data = [];
        response.on("data", (chunk) => data.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(data).toString()) }));
        response.on("error", reject);
      });
      request.on("error", reject);
      request.on("timeout", () => request.destroy(new Error("request timeout")));
      for (const chunk of chunks) request.write(chunk);
      request.end();
    });
  }
  try {
    const before = await stateFiles(f.dataDir);
    const host = await raw({ Host: "rebinding.example", "Content-Type": "application/json" }, ['{}']);
    assert.equal(host.status, 403);
    assert.equal(host.body.code, "untrusted_host");
    const large = await raw({ "Content-Type": "application/json", "Transfer-Encoding": "chunked" }, ['{"title":"', "x".repeat(65536), "x".repeat(65536), '"}']);
    assert.equal(large.status, 413);
    assert.equal(large.body.code, "body_too_large");
    assert.deepEqual(await stateFiles(f.dataDir), before);
  } finally { await f.close(); }
});
