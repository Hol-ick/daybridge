import test from "node:test";
import assert from "node:assert/strict";

import { buildDailySchedule, getAvailableFocusSlots, rebuildRemainingSchedule, resolveNowFocus } from "./scheduler.js";

const DATE = "2026-08-24";
const settings = { dayStart: "09:00", dayEnd: "15:00", focusDurations: [25, 50], bufferMinutes: 10 };
const candidate = (id, priority, estimateMinutes, dependsOn = []) => ({ id, title: id, priority, estimateMinutes, remainingMinutes: estimateMinutes, dependsOn, execution: "independent", state: "ready", sourceRefs: [] });

test("empty time settings produce an untimed todo list without invented work hours", () => {
  const schedule = buildDailySchedule({
    date: DATE,
    settings: { dayStart: "", dayEnd: "", timeConfigured: false },
    taskCandidates: [candidate("first", "must", 50), candidate("second", "should", 100)],
  });

  assert.equal(schedule.mode, "todo");
  assert.equal(schedule.timeConfigured, false);
  assert.deepEqual(schedule.blocks.map((block) => [block.questId, block.startAt, block.endAt, block.status]), [
    ["first", undefined, undefined, "planned"],
    ["second", undefined, undefined, "planned"],
  ]);
  assert.deepEqual(schedule.unscheduled, []);
  assert.equal(resolveNowFocus(schedule, "2026-08-24T10:00:00+09:00").state, "todo_list");
  assert.deepEqual(getAvailableFocusSlots({ date: DATE, settings: { timeConfigured: false } }), []);
});

test("buildDailySchedule gives must work the first available 50-minute block and leaves a transition buffer", () => {
  const schedule = buildDailySchedule({
    date: DATE,
    settings,
    taskCandidates: [candidate("could", "could", 25), candidate("must", "must", 50), candidate("should", "should", 25)],
    busyBlocks: [{ id: "calendar-busy", startAt: "2026-08-24T10:00:00+09:00", endAt: "2026-08-24T10:30:00+09:00" }],
  });

  assert.deepEqual(schedule.blocks.filter((block) => !block.hidden).map((block) => [block.type, block.questId || block.id, block.startAt, block.endAt]), [
    ["focus", "must", "2026-08-24T09:00:00+09:00", "2026-08-24T09:50:00+09:00"],
    ["buffer", "buffer-after-must-1", "2026-08-24T09:50:00+09:00", "2026-08-24T10:00:00+09:00"],
    ["busy", "calendar-busy", "2026-08-24T10:00:00+09:00", "2026-08-24T10:30:00+09:00"],
    ["focus", "should", "2026-08-24T13:00:00+09:00", "2026-08-24T13:50:00+09:00"],
    ["buffer", "buffer-after-should-1", "2026-08-24T13:50:00+09:00", "2026-08-24T14:00:00+09:00"],
    ["focus", "could", "2026-08-24T14:00:00+09:00", "2026-08-24T14:50:00+09:00"],
  ]);
  assert.deepEqual(schedule.unscheduled, []);
});

test("buildDailySchedule honors dependencies and reports work that cannot fit", () => {
  const schedule = buildDailySchedule({
    date: DATE,
    settings: { ...settings, dayEnd: "11:00" },
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

test("briefing quests always take precedence over optional routine blocks", () => {
  const routine = { ...candidate("routine-linux", "could", 50), title: "리눅스 학습", sourceKind: "routine" };
  const schedule = buildDailySchedule({
    date: DATE,
    settings: { ...settings, dayEnd: "10:00", bufferMinutes: 0 },
    taskCandidates: [routine, candidate("briefing-must", "must", 50)],
  });
  assert.deepEqual(schedule.blocks.filter((block) => block.type === "focus").map((block) => block.questId), ["briefing-must"]);
  assert.deepEqual(schedule.unscheduled, [{ questId: "routine-linux", reason: "insufficient_time", remainingMinutes: 50 }]);
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
  assert.deepEqual([focus.startAt, focus.endAt], ["2026-08-24T10:00:00+09:00", "2026-08-24T10:50:00+09:00"]);
});

test("buildDailySchedule aligns every focus block to the next hourly boundary", () => {
  const schedule = buildDailySchedule({
    date: DATE,
    settings,
    startAt: "2026-08-24T09:10:00+09:00",
    taskCandidates: [candidate("first", "must", 15), candidate("second", "should", 15)],
    busyBlocks: [{ id: "busy", startAt: "2026-08-24T10:15:00+09:00", endAt: "2026-08-24T10:30:00+09:00" }],
  });

  assert.deepEqual(schedule.blocks.filter((block) => block.type === "focus").map((block) => [block.startAt, block.endAt]), [
    ["2026-08-24T13:00:00+09:00", "2026-08-24T13:50:00+09:00"],
    ["2026-08-24T14:00:00+09:00", "2026-08-24T14:50:00+09:00"],
  ]);
});

test("buildDailySchedule splits manual work into one 50-minute unit per hour", () => {
  const schedule = buildDailySchedule({
    date: DATE,
    settings: { dayStart: "09:00", dayEnd: "14:00", bufferMinutes: 0 },
    taskCandidates: [candidate("manual-linux", "must", 100)],
  });

  assert.deepEqual(schedule.blocks.filter((block) => block.type === "focus").map((block) => [block.questId, block.startAt.slice(11, 16), block.endAt.slice(11, 16)]), [
    ["manual-linux", "09:00", "09:50"],
    ["manual-linux", "10:00", "10:50"],
  ]);
  assert.deepEqual(schedule.unscheduled, []);

  const longer = buildDailySchedule({
    date: DATE,
    settings: { dayStart: "09:00", dayEnd: "15:00", bufferMinutes: 0 },
    taskCandidates: [candidate("manual-linux-long", "must", 150)],
  });
  assert.equal(longer.blocks.filter((block) => block.type === "focus" && block.questId === "manual-linux-long").length, 3);
});

test("buildDailySchedule reserves the lunch window and skips a busy afternoon slot", () => {
  const schedule = buildDailySchedule({
    date: DATE,
    settings: { dayStart: "09:00", dayEnd: "16:00", bufferMinutes: 0 },
    taskCandidates: [candidate("lunch-safe", "must", 150)],
    busyBlocks: [{ id: "afternoon-busy", startAt: "2026-08-24T13:00:00+09:00", endAt: "2026-08-24T14:00:00+09:00" }],
  });

  assert.deepEqual(schedule.blocks.filter((block) => block.type === "focus").map((block) => [block.startAt.slice(11, 16), block.endAt.slice(11, 16)]), [
    ["09:00", "09:50"],
    ["10:00", "10:50"],
    ["14:00", "14:50"],
  ]);
  assert.equal(schedule.blocks.some((block) => block.type === "focus" && ["11:00", "12:00", "13:00"].includes(block.startAt.slice(11, 16))), false);
});

test("buildDailySchedule migrates a stale locked lunch placement to a legal slot", () => {
  const schedule = buildDailySchedule({
    date: DATE,
    settings: { dayStart: "09:00", dayEnd: "15:00", bufferMinutes: 0 },
    taskCandidates: [candidate("migrated", "must", 50)],
    lockedBlocks: [{ id: "stale-lunch-focus", type: "focus", questId: "old", title: "예전 점심 작업", startAt: "2026-08-24T12:00:00+09:00", endAt: "2026-08-24T12:50:00+09:00", locked: true }],
  });

  assert.equal(schedule.blocks.some((block) => block.id === "stale-lunch-focus"), false);
  assert.equal(schedule.blocks.find((block) => block.questId === "migrated")?.startAt.slice(11, 16), "09:00");
});

test("resolveNowFocus distinguishes active work, calendar time, upcoming work, and free time", () => {
  const schedule = buildDailySchedule({ date: DATE, settings, taskCandidates: [candidate("must", "must", 50)], busyBlocks: [{ id: "busy", startAt: "2026-08-24T11:00:00+09:00", endAt: "2026-08-24T11:30:00+09:00" }] });

  assert.equal(resolveNowFocus(schedule, "2026-08-24T09:10:00+09:00").state, "active_focus");
  assert.equal(resolveNowFocus(schedule, "2026-08-24T11:10:00+09:00").state, "in_busy_time");
  assert.equal(resolveNowFocus(schedule, "2026-08-24T08:40:00+09:00").state, "up_next");
  assert.equal(resolveNowFocus(schedule, "2026-08-24T12:00:00+09:00").state, "in_busy_time");
  assert.equal(resolveNowFocus(schedule, "2026-08-24T13:00:00+09:00").state, "free_time");
});

test("resolveNowFocus skips completed, skipped, and deferred focus blocks", () => {
  const schedule = buildDailySchedule({ date: DATE, settings, taskCandidates: [candidate("first", "must", 50), candidate("second", "should", 50)] });
  const [first, second] = schedule.blocks.filter((block) => block.type === "focus");
  const updated = { ...schedule, blocks: [{ ...first, status: "completed" }, { ...second, status: "planned" }] };

  const result = resolveNowFocus(updated, "2026-08-24T08:40:00+09:00");
  assert.equal(result.state, "up_next");
  assert.equal(result.block.id, second.id);
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
  assert.ok(rebuilt.blocks.some((block) => block.questId === "should" && block.startAt === "2026-08-24T13:00:00+09:00"));
});
