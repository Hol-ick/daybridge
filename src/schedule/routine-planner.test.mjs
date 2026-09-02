import assert from "node:assert/strict";
import test from "node:test";

import { buildRoutineCandidates } from "./routine-planner.js";

test("the daily default routine fills an otherwise empty day", () => {
  const routines = buildRoutineCandidates({ date: "2026-08-24", board: { quests: [] } });
  assert.deepEqual(routines.map((item) => [item.id, item.title, item.estimateMinutes, item.sourceKind, item.category]), [["routine-supplement", "영양제 먹기", 25, "routine", "health"]]);
  assert.deepEqual(buildRoutineCandidates({ date: "2026-08-23", board: { quests: [] } }).map((item) => item.title), ["영양제 먹기"]);
});

test("briefing work with the same title suppresses a duplicate routine", () => {
  const routines = buildRoutineCandidates({ date: "2026-08-24", board: { quests: [{ title: "영양제 먹기" }] } });
  assert.deepEqual(routines, []);
});

test("routine choices respect enabled state and their declared days", () => {
  const routines = buildRoutineCandidates({ date: "2026-08-23", board: { quests: [] }, routines: [{ id: "weekend", title: "리눅스 학습", estimateMinutes: 25, days: [0] }, { id: "disabled", title: "숨김", estimateMinutes: 25, days: [0], enabled: false }] });
  assert.deepEqual(routines.map((item) => item.title), ["리눅스 학습"]);
});
