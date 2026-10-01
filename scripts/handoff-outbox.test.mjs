import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startFixtureBridge } from "./test-support/fixture-bridge.mjs";
import { enqueueHandoff, flushHandoffOutbox } from "./bridge/handoff-outbox.mjs";
import { withDateTransaction } from "./storage/date-transaction.mjs";
import { readActivityLog, recordActivity, projectActivityLog, repairActivityProjections } from "./activity-log.mjs";
import { readJsonStrict } from "./storage/json-store.mjs";

const date = "2099-01-02";
test("sink failure preserves local success and retry delivers one stable event", async () => {
  const f = await startFixtureBridge({ initialFiles: {
    [`boards/${date}.json`]: JSON.stringify({ schemaVersion: 2, activityDate: date, quests: [], sourceWarnings: [] }),
    "schedule-settings.json": JSON.stringify({ timeConfigured: false }),
  } });
  try {
    const blocker = join(f.appDataDir, "blocked");
    const sink = join(blocker, "sink");
    await writeFile(blocker, "fixture obstruction");
    await writeFile(join(f.dataDir, "config.json"), JSON.stringify({ handoffSinkDir: sink }));
    const payload = { activityDate: date, title: "fixture pending" };
    const options = { requestId: "outbox-001" };
    const first = await f.request("POST", "/api/quests/manual", payload, options);
    assert.equal(first.status, 201);
    assert.equal(first.body.saveState, "local_saved");
    assert.equal(first.body.handoff.state, "pending");
    assert.equal(first.body.handoff.failed, 1);
    assert.equal((await readdir(join(f.dataDir, "events", date))).length, 1);
    await unlink(blocker);
    await mkdir(sink, { recursive: true });
    const second = await f.request("POST", "/api/quests/manual", payload, options);
    assert.equal(second.status, 201);
    assert.equal(second.body.quest.id, first.body.quest.id);
    assert.equal(second.body.handoff.state, "sent");
    const names = await readdir(join(sink, date));
    assert.equal(names.length, 1);
    const third = await f.request("POST", "/api/quests/manual", payload, options);
    assert.equal(third.body.quest.id, first.body.quest.id);
    assert.equal((await readdir(join(sink, date))).length, 1);
    const event = JSON.parse(await readFile(join(sink, date, names[0]), "utf8"));
    assert.equal(names[0], event.id + ".json");
    const record = JSON.parse(await readFile(join(f.dataDir, "outbox", names[0]), "utf8"));
    assert.equal(record.state, "sent");
  } finally { await f.close(); }
});

test("delivery gap after external write is recovered by a fresh process without duplicate files", async () => {
  const f = await startFixtureBridge();
  try {
    const sinkDir = join(f.appDataDir, "handoff");
    const event = { id: "fixture-delivery-gap", activityDate: date, source: "daybridge", status: "completed" };
    await enqueueHandoff({ dataDir: f.dataDir, event });
    const first = await flushHandoffOutbox({ dataDir: f.dataDir, sinkDir, onDelivered: () => { throw new Error("fixture gap"); } });
    assert.deepEqual(first, { sent: 0, pending: 1, failed: 1 });
    assert.equal((await readdir(join(sinkDir, date))).length, 1);
    const moduleUrl = new URL("./bridge/handoff-outbox.mjs", import.meta.url).href;
    const code = `import { flushHandoffOutbox } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await flushHandoffOutbox(JSON.parse(process.argv[1]))));`;
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", code, JSON.stringify({ dataDir: f.dataDir, sinkDir })]);
    assert.deepEqual(JSON.parse(stdout), { sent: 1, pending: 0, failed: 0 });
    assert.equal((await readdir(join(sinkDir, date))).length, 1);
    assert.deepEqual(await flushHandoffOutbox({ dataDir: f.dataDir, sinkDir }), { sent: 0, pending: 0, failed: 0 });
  } finally { await f.close(); }
});

test("failed local transaction leaves neither outbox nor successful activity evidence", async () => {
  const f = await startFixtureBridge();
  try {
    await assert.rejects(withDateTransaction({ dataDir: f.dataDir, date }, async () => {
      await enqueueHandoff({ dataDir: f.dataDir, event: { id: "fixture-rollback", activityDate: date } });
      await recordActivity(f.dataDir, { activityDate: date, action: "task_added", subject: { title: "fixture rollback" } });
      await assert.rejects(flushHandoffOutbox({ dataDir: f.dataDir, sinkDir: join(f.appDataDir, "sink") }), e => e.code === "outbox_before_commit");
      throw new Error("fixture abort");
    }), /fixture abort/);
    assert.equal(await readJsonStrict(join(f.dataDir, "outbox", "fixture-rollback.json")), null);
    assert.deepEqual(await readActivityLog(f.dataDir, date), []);
  } finally { await f.close(); }
});

test("damaged destination is preserved and a bounded flush leaves remaining items pending", async () => {
  const f = await startFixtureBridge();
  try {
    const sinkDir = join(f.appDataDir, "handoff");
    await mkdir(join(sinkDir, date), { recursive: true });
    for (const id of ["a", "b", "c"]) await enqueueHandoff({ dataDir: f.dataDir, event: { id, activityDate: date } });
    const path = join(sinkDir, date, "a.json");
    await writeFile(path, "{damaged");
    assert.deepEqual(await flushHandoffOutbox({ dataDir: f.dataDir, sinkDir, limit: 2 }), { sent: 1, pending: 2, failed: 1 });
    assert.equal(await readFile(path, "utf8"), "{damaged");
    await assert.rejects(flushHandoffOutbox({ dataDir: f.dataDir, sinkDir: join(f.dataDir, "internal") }), e => e.code === "invalid_handoff_sink");
    const alias = join(f.appDataDir, "data-alias");
    await symlink(f.dataDir, alias, "junction");
    await assert.rejects(flushHandoffOutbox({ dataDir: f.dataDir, sinkDir: join(alias, "sink") }), e => e.code === "invalid_handoff_sink");
  } finally { await f.close(); }
});

test("legacy activity is preserved and projection failure does not erase committed records", async () => {
  const legacy = { id: "legacy", activityDate: date, action: "task_added", occurredAt: "2099-01-02T00:00:00Z", subject: { title: "fixture legacy" } };
  const original = JSON.stringify(legacy) + "\n";
  const f = await startFixtureBridge({ initialFiles: { [`activity/${date}.ndjson`]: original } });
  try {
    await mkdir(join(f.dataDir, "activity", `${date}.md`));
    await recordActivity(f.dataDir, { activityDate: date, action: "task_added", subject: { title: "fixture new" } });
    assert.equal((await readActivityLog(f.dataDir, date)).length, 2);
    assert.equal(await readFile(join(f.dataDir, "activity", `${date}.ndjson`), "utf8"), original);
    await assert.rejects(projectActivityLog(f.dataDir, date));
    assert.equal((await readActivityLog(f.dataDir, date)).length, 2);
    assert.equal((await readJsonStrict(join(f.dataDir, "activity", `${date}.json`))).projectionPending, true);
    await rmdir(join(f.dataDir, "activity", `${date}.md`));
    assert.deepEqual(await repairActivityProjections(f.dataDir), { repaired: 1, failed: 0 });
    assert.equal((await readJsonStrict(join(f.dataDir, "activity", `${date}.json`))).projectionPending, false);
    assert.match(await readFile(join(f.dataDir, "activity", `${date}.md`), "utf8"), /fixture new/);
  } finally { await f.close(); }
});
