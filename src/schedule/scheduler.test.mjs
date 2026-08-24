import test from "node:test";
import assert from "node:assert/strict";

import { buildDailySchedule, rebuildRemainingSchedule, resolveNowFocus } from "./scheduler.js";

const DATE = "2026-08-24";
const settings = { dayStart: "09:00", dayEnd: "13:00", focusDurations: [50, 25], bufferMinutes: 10 };
const candidate = (id, priority, estimateMinutes, dependsOn = []) => ({ id, title: id, priority, estimateMinutes, remainingMinutes: estimateMinutes, dependsOn, execution: "independent", state: "ready", sourceRefs: [] });

test("buildDailySchedule gives must work the first available 50-minute block and leaves a transition buffer", () => {
  const schedule = buildDailySchedule({
    date: DATE,
    settings,
    taskCandidates: [candidate("could", "could", 25), candidate("must", "must", 50), candidate("should", "should", 25)],
    busyBlocks: [{ id: "calendar-busy", startAt: "2026-08-24T10:00:00+09:00", endAt: "2026-08-24T10:30:00+09:00" }],
  });

  assert.deepEqual(schedule.blocks.map((block) => [block.type, block.questId || block.id, block.startAt, block.endAt]), [
    ["focus", "must", "2026-08-24T09:00:00+09:00", "2026-08-24T09:50:00+09:00"],
    ["buffer", "buffer-after-must-1", "2026-08-24T09:50:00+09:00", "2026-08-24T10:00:00+09:00"],
    ["busy", "calendar-busy", "2026-08-24T10:00:00+09:00", "2026-08-24T10:30:00+09:00"],
    ["focus", "should", "2026-08-24T10:30:00+09:00", "2026-08-24T10:55:00+09:00"],
    ["buffer", "buffer-after-should-1", "2026-08-24T10:55:00+09:00", "2026-08-24T11:05:00+09:00"],
    ["focus", "could", "2026-08-24T11:05:00+09:00", "2026-08-24T11:30:00+09:00"],
  ]);
  assert.deepEqual(schedule.unscheduled, []);
});

test("buildDailySchedule honors dependencies and reports work that cannot fit", () => {
  const schedule = buildDailySchedule({
    date: DATE,
    settings: { ...settings, dayEnd: "10:30" },
    taskCandidates: [candidate("child", "must", 25, ["parent"]), candidate("parent", "should", 50), candidate("later", "could", 25)],
  });

  assert.deepEqual(schedule.blocks.filter((block) => block.type === "focus").map((block) => block.questId), ["parent", "child"]);
  assert.deepEqual(schedule.unscheduled, [{ questId: "later", reason: "insufficient_time", remainingMinutes: 25 }]);
});

test("buildDailySchedule brings a deferred carryover quest back into the next day's focus blocks", () => {
  const carryover = { ...candidate("carryover", "must", 25), state: "deferred" };
  const schedule = buildDailySchedule({ date: DATE, settings, taskCandidates: [carryover] });

  assert.equal(schedule.blocks.find((block) => block.type === "focus")?.questId, "carryover");
  assert.deepEqual(schedule.unscheduled, []);
});

test("buildDailySchedule does not place a dependent quest when its prerequisite could not be placed", () => {
  const schedule = buildDailySchedule({
    date: DATE,
    settings: { ...settings, dayEnd: "09:20" },
    taskCandidates: [candidate("child", "must", 25, ["parent"]), candidate("parent", "should", 50)],
  });

  assert.deepEqual(schedule.blocks.filter((block) => block.type === "focus"), []);
  assert.deepEqual(schedule.unscheduled, [
    { questId: "parent", reason: "insufficient_time", remainingMinutes: 50 },
    { questId: "child", reason: "dependency_unmet", remainingMinutes: 25 },
  ]);
});

test("buildDailySchedule retains locked existing focus blocks and never overlaps them or busy time", () => {
  const schedule = buildDailySchedule({
    date: DATE,
    settings,
    taskCandidates: [candidate("must", "must", 50)],
    busyBlocks: [{ id: "busy", startAt: "2026-08-24T11:00:00+09:00", endAt: "2026-08-24T12:00:00+09:00" }],
    lockedBlocks: [{ id: "locked-focus", type: "focus", questId: "locked", startAt: "2026-08-24T09:00:00+09:00", endAt: "2026-08-24T09:25:00+09:00", locked: true }],
  });

  assert.equal(schedule.blocks.find((block) => block.id === "locked-focus")?.locked, true);
  const focus = schedule.blocks.find((block) => block.questId === "must");
  assert.deepEqual([focus.startAt, focus.endAt], ["2026-08-24T09:25:00+09:00", "2026-08-24T10:15:00+09:00"]);
});

test("resolveNowFocus distinguishes active work, calendar time, upcoming work, and free time", () => {
  const schedule = buildDailySchedule({ date: DATE, settings, taskCandidates: [candidate("must", "must", 50)], busyBlocks: [{ id: "busy", startAt: "2026-08-24T11:00:00+09:00", endAt: "2026-08-24T11:30:00+09:00" }] });

  assert.equal(resolveNowFocus(schedule, "2026-08-24T09:10:00+09:00").state, "active_focus");
  assert.equal(resolveNowFocus(schedule, "2026-08-24T11:10:00+09:00").state, "in_busy_time");
  assert.equal(resolveNowFocus(schedule, "2026-08-24T08:40:00+09:00").state, "up_next");
  assert.equal(resolveNowFocus(schedule, "2026-08-24T12:00:00+09:00").state, "free_time");
});

test("rebuildRemainingSchedule preserves elapsed and locked blocks while moving remaining work after now", () => {
  const original = buildDailySchedule({ date: DATE, settings, taskCandidates: [candidate("must", "must", 50), candidate("should", "should", 25)] });
  const rebuilt = rebuildRemainingSchedule({
    schedule: original,
    now: "2026-08-24T09:30:00+09:00",
    settings,
    taskCandidates: [candidate("must", "must", 50), candidate("should", "should", 25)],
    lockedBlocks: [{ id: "fixed", type: "busy", startAt: "2026-08-24T10:00:00+09:00", endAt: "2026-08-24T10:30:00+09:00", locked: true }],
  });

  assert.ok(rebuilt.blocks.some((block) => block.questId === "must" && block.startAt === "2026-08-24T09:00:00+09:00"));
  assert.ok(rebuilt.blocks.some((block) => block.id === "fixed"));
  assert.ok(rebuilt.blocks.some((block) => block.questId === "should" && block.startAt >= "2026-08-24T10:30:00+09:00"));
});
