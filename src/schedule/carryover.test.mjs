import test from "node:test";
import assert from "node:assert/strict";
import { carryoverTaskCandidates } from "./carryover.js";
import { buildDailySchedule } from "./scheduler.js";
import { toTaskCandidate } from "./model.js";

test("carryover candidates keep unfinished blocks and unscheduled minutes", () => {
  const candidates = carryoverTaskCandidates({
    date: "2026-09-08",
    mode: "timed",
    timeConfigured: true,
    blocks: [
      { id: "focus-open", type: "focus", questId: "quest-open", title: "남은 작업", status: "planned", startAt: "2026-09-08T09:00:00+09:00", endAt: "2026-09-08T09:50:00+09:00" },
      { id: "focus-active", type: "focus", questId: "quest-active", title: "진행 중 작업", status: "in_progress", startAt: "2026-09-08T10:00:00+09:00", endAt: "2026-09-08T10:50:00+09:00" },
      { id: "focus-deferred", type: "focus", questId: "quest-deferred", title: "미룬 작업", status: "deferred", startAt: "2026-09-08T11:00:00+09:00", endAt: "2026-09-08T11:50:00+09:00" },
      { id: "focus-done", type: "focus", questId: "quest-done", title: "끝난 작업", status: "completed", startAt: "2026-09-08T13:00:00+09:00", endAt: "2026-09-08T13:50:00+09:00" },
      { id: "focus-skipped", type: "focus", questId: "quest-skipped", title: "건너뛴 작업", status: "skipped", startAt: "2026-09-08T14:00:00+09:00", endAt: "2026-09-08T14:50:00+09:00" },
    ],
    unscheduled: [{ questId: "quest-open", remainingMinutes: 25 }],
  });

  assert.deepEqual(candidates.map((candidate) => candidate.id), ["quest-open", "quest-active", "quest-deferred"]);
  assert.equal(candidates.find((candidate) => candidate.id === "quest-open").remainingMinutes, 75);
  assert.equal(candidates.find((candidate) => candidate.id === "quest-active").state, "in_progress");
  assert.equal(candidates.find((candidate) => candidate.id === "quest-deferred").state, "deferred");
});

test("exact work minutes, dependencies and provenance survive multiple dates", () => {
  const task = { id: "a", title: "fixture dependency", state: "ready", estimateMinutes: 75, remainingMinutes: 75, dependsOn: ["prerequisite"], execution: "sequential", sourceKind: "session", sourceRefs: ["daybridge://fixture/source"] };
  const first = buildDailySchedule({ date: "2099-01-02", settings: { timeConfigured: false }, taskCandidates: [task] });
  const carried = carryoverTaskCandidates(first)[0];
  assert.equal(carried.remainingMinutes, 75);
  assert.deepEqual(carried.dependsOn, ["prerequisite"]);
  assert.equal(carried.execution, "sequential");
  assert.deepEqual(carried.sourceRefs, task.sourceRefs);
  assert.equal(carried.carryoverCount, 1);
  assert.equal(carried.carryoverSourceDate, "2099-01-02");
  const second = buildDailySchedule({ date: "2099-01-05", settings: { timeConfigured: false }, taskCandidates: [carried] });
  const again = carryoverTaskCandidates(second)[0];
  assert.equal(again.remainingMinutes, 75);
  assert.equal(again.carryoverCount, 2);
  assert.equal(again.carryoverSourceDate, "2099-01-02");
  assert.deepEqual(again.dependsOn, task.dependsOn);
  assert.equal(toTaskCandidate({ ...task, focusUnits: 2, remainingUnits: 2, remainingMinutes: 25 }).remainingMinutes, 25);
});

test("timed work units and unscheduled metadata retain the exact remaining amount", () => {
  const previous = {
    date: "2099-01-02", mode: "timed", blocks: [
      { type: "focus", questId: "a", title: "fixture", status: "completed", workMinutes: 50 },
      { type: "focus", questId: "a", title: "fixture", status: "planned", workMinutes: 25, taskMetadata: { dependsOn: ["b"], execution: "sequential", carryoverCount: 2, carryoverSourceDate: "2098-12-31" } },
    ], unscheduled: [{ questId: "c", remainingMinutes: 15, taskMetadata: { title: "fixture unscheduled", dependsOn: ["a"], sourceKind: "session" } }],
  };
  const candidates = carryoverTaskCandidates(previous);
  assert.equal(candidates.find(t => t.id === "a").remainingMinutes, 25);
  assert.equal(candidates.find(t => t.id === "a").carryoverCount, 3);
  assert.equal(candidates.find(t => t.id === "c").title, "fixture unscheduled");
  assert.deepEqual(candidates.find(t => t.id === "c").dependsOn, ["a"]);
});

test("a prerequisite completed on the source date remains satisfied after two carryovers", () => {
  const source = { date: "2099-01-02", mode: "todo", blocks: [{ type: "focus", questId: "parent", status: "completed" }], unscheduled: [{ questId: "child", remainingMinutes: 25, taskMetadata: { title: "fixture child", dependsOn: ["parent"], execution: "sequential" } }] };
  let candidates = carryoverTaskCandidates(source);
  for (const date of ["2099-01-05", "2099-01-08"]) {
    const schedule = buildDailySchedule({ date, settings: { dayStart: "09:00", dayEnd: "11:00", timeConfigured: true, bufferMinutes: 0 }, taskCandidates: candidates });
    assert.equal(schedule.blocks.filter(b => b.type === "focus" && b.questId === "child").length, 1);
    candidates = carryoverTaskCandidates(schedule);
    assert.equal(candidates[0].remainingMinutes, 25);
    assert.deepEqual(candidates[0].completedDependencies, ["parent"]);
  }
});

test("todo carryover treats each remaining card as one lightweight task", () => {
  const candidates = carryoverTaskCandidates({
    date: "2026-09-08",
    mode: "todo",
    timeConfigured: false,
    blocks: [{ id: "todo-open", type: "focus", questId: "quest-open", title: "오늘 못 한 일", status: "planned" }],
    unscheduled: [],
  });

  assert.equal(candidates[0].remainingMinutes, 25);
  assert.equal(candidates[0].sourceLabel, "전날 미완료 일정");
});
