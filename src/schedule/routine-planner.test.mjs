import assert from "node:assert/strict";
import test from "node:test";

import { buildRoutineCandidates } from "./routine-planner.js";

test("weekday default routines fill an otherwise empty briefing day", () => {
  const routines = buildRoutineCandidates({ date: "2026-08-24", board: { quests: [] } });
  assert.deepEqual(routines.map((item) => [item.id, item.title, item.estimateMinutes, item.sourceKind]), [["routine-linux-learning", "리눅스 학습", 50, "routine"]]);
});

test("briefing work with the same title suppresses a duplicate routine", () => {
  const routines = buildRoutineCandidates({ date: "2026-08-24", board: { quests: [{ title: "리눅스 학습" }] } });
  assert.deepEqual(routines, []);
});

test("routine choices respect enabled state and their declared days", () => {
  const routines = buildRoutineCandidates({ date: "2026-08-23", board: { quests: [] }, routines: [{ id: "weekend", title: "리눅스 학습", estimateMinutes: 25, days: [0] }, { id: "disabled", title: "숨김", estimateMinutes: 25, days: [0], enabled: false }] });
  assert.deepEqual(routines.map((item) => item.title), ["리눅스 학습"]);
});
