import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { applyMutation } from "./bridge/mutation-service.mjs";
import { atomicWriteJson, readJsonStrict } from "./storage/json-store.mjs";
import { startFixtureBridge } from "./test-support/fixture-bridge.mjs";

const date = "2099-01-02";
const seeds = {
  [`boards/${date}.json`]: JSON.stringify({ schemaVersion: 2, activityDate: date, quests: [], sourceWarnings: [] }),
  "schedule-settings.json": JSON.stringify({ timeConfigured: false }),
};

test("lost response retry preserves one quest, event and activity record", async () => {
  const f = await startFixtureBridge({ initialFiles: seeds });
  try {
    const payload = { activityDate: date, title: "fixture retry" };
    const options = { requestId: "fixture-retry-001" };
    const first = await f.request("POST", "/api/quests/manual", payload, options);
    const second = await f.request("POST", "/api/quests/manual", payload, options);
    assert.equal(first.status, 201);
    assert.equal(second.body.quest.id, first.body.quest.id);
    assert.equal(second.headers.get("x-request-replayed"), "true");
    const board = JSON.parse(await readFile(join(f.dataDir, "boards", `${date}.json`), "utf8"));
    assert.equal(board.quests.length, 1);
    assert.equal((await readdir(join(f.dataDir, "events", date))).length, 1);
    const activity = await f.request("GET", `/api/activity?date=${date}`);
    assert.equal(activity.body.records.filter(r => r.action === "task_added").length, 1);
    const conflict = await f.request("POST", "/api/quests/manual", { ...payload, title: "different" }, options);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, "request_id_conflict");
  } finally { await f.close(); }
});

test("concurrent retries commit once and a fresh process replays the durable receipt", async () => {
  const f = await startFixtureBridge();
  try {
    const input = { dataDir: f.dataDir, date, requestId: "concurrent-001", kind: "fixture", payload: { b: 2, a: 1 } };
    let executions = 0;
    const results = await Promise.all(Array.from({ length: 20 }, () => applyMutation(input, async () => {
      executions++;
      await atomicWriteJson(join(f.dataDir, "counter.json"), { count: executions });
      return { id: "first-result" };
    })));
    assert.equal(executions, 1);
    assert.equal(results.filter(r => !r.replayed).length, 1);
    assert.deepEqual(await readJsonStrict(join(f.dataDir, "counter.json")), { count: 1 });
    const moduleUrl = new URL("./bridge/mutation-service.mjs", import.meta.url).href;
    const code = `import { applyMutation } from ${JSON.stringify(moduleUrl)}; const result = await applyMutation(JSON.parse(process.argv[1]), () => { throw new Error('must not execute'); }); console.log(JSON.stringify(result));`;
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", code, JSON.stringify({ ...input, payload: { a: 1, b: 2 } })]);
    assert.deepEqual(JSON.parse(stdout), { result: { id: "first-result" }, replayed: true });
    await assert.rejects(applyMutation({ ...input, date: "2099-01-03" }, async () => ({})), e => e.status === 409);
  } finally { await f.close(); }
});

test("failed mutation has no receipt or state and can be retried with the same ID", async () => {
  const f = await startFixtureBridge();
  try {
    const input = { dataDir: f.dataDir, date, requestId: "failed-001", kind: "fixture", payload: {} };
    await assert.rejects(applyMutation(input, async () => {
      await atomicWriteJson(join(f.dataDir, "counter.json"), { count: 1 });
      throw new Error("fixture failure before commit");
    }), /fixture failure/);
    assert.equal(await readJsonStrict(join(f.dataDir, "counter.json")), null);
    assert.deepEqual(await applyMutation(input, async () => ({ id: "retry-success" })), { result: { id: "retry-success" }, replayed: false });
    await assert.rejects(applyMutation({ ...input, requestId: "../outside" }, async () => ({})), e => e.status === 400);
  } finally { await f.close(); }
});
