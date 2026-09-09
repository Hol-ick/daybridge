import test from "node:test";
import assert from "node:assert/strict";
import { carryoverTaskCandidates } from "./carryover.js";

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

