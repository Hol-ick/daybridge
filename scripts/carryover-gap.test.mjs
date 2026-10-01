import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { startFixtureBridge } from "./test-support/fixture-bridge.mjs";

const previous = "2099-01-02";
const today = "2099-01-05";
function schedule(date, blocks = []) { return { schemaVersion: 1, date, timezone: "Asia/Seoul", mode: "todo", timeConfigured: false, generatedAt: `${date}T00:00:00+09:00`, blocks, unscheduled: [] }; }
function seeds() { return { "schedules/latest.json": "{ignored", "schedules/2099-12-31.json": "{future ignored", "daily-defaults.json": JSON.stringify({ routines: [] }), "schedule-settings.json": JSON.stringify({ timeConfigured: false }), [`schedules/${previous}.json`]: JSON.stringify(schedule(previous, [
  { id: "todo-open", questId: "open", type: "focus", title: "fixture open", status: "planned" },
  { id: "todo-done", questId: "done", type: "focus", title: "fixture done", status: "completed" },
  { id: "todo-skipped", questId: "skipped", type: "focus", title: "fixture skipped", status: "skipped" },
])) }; }

test("inactive dates use the most recent schedule and repeated rebuild does not duplicate work", async () => {
  const f = await startFixtureBridge({ initialFiles: seeds() });
  try {
    for (const date of [today, today, "2099-02-05"]) {
      const r = await f.request("POST", "/api/schedule/rebuild", { activityDate: date });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.schedule.blocks.filter(b => b.type === "focus").map(b => b.questId), ["open"]);
      assert.equal(r.body.schedule.carryover.sourceDate, date === "2099-02-05" ? today : previous);
    }
  } finally { await f.close(); }
});

test("a recent empty schedule stops carryover rather than resurrecting older work", async () => {
  const initialFiles = seeds();
  initialFiles["schedules/2099-01-04.json"] = JSON.stringify(schedule("2099-01-04"));
  const f = await startFixtureBridge({ initialFiles });
  try {
    const r = await f.request("POST", "/api/schedule/rebuild", { activityDate: today });
    assert.equal(r.status, 200);
    assert.equal(r.body.schedule.blocks.filter(b => b.type === "focus").length, 0);
    assert.equal(r.body.schedule.carryover.sourceDate, "2099-01-04");
  } finally { await f.close(); }
});

test("damaged recent source is preserved and never silently skipped", async () => {
  const initialFiles = seeds();
  initialFiles["schedules/2099-01-03.json"] = "{broken";
  const f = await startFixtureBridge({ initialFiles });
  try {
    const r = await f.request("POST", "/api/schedule/rebuild", { activityDate: today });
    assert.equal(r.status, 500);
    assert.equal(r.body.code, "corrupt_json");
    assert.equal(await readFile(join(f.dataDir, "schedules", "2099-01-03.json"), "utf8"), "{broken");
  } finally { await f.close(); }
});

test("history with a mismatched embedded date is preserved as an error", async () => {
  const initialFiles = seeds();
  const original = JSON.stringify(schedule(previous));
  initialFiles["schedules/2099-01-03.json"] = original;
  const f = await startFixtureBridge({ initialFiles });
  try {
    const r = await f.request("POST", "/api/schedule/rebuild", { activityDate: today });
    assert.equal(r.status, 500);
    assert.equal(r.body.code, "invalid_record");
    assert.equal(await readFile(join(f.dataDir, "schedules", "2099-01-03.json"), "utf8"), original);
  } finally { await f.close(); }
});
