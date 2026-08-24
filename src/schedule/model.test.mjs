import test from "node:test";
import assert from "node:assert/strict";

import { createScheduleShell, normalizeSchedule, toScheduleTitle, toTaskCandidate } from "./model.js";

const DATE = "2026-08-24";

test("toTaskCandidate converts a Quest without exposing source details", () => {
  const candidate = toTaskCandidate({
    id: "quest-calendar",
    title: "캘린더 연동 설계 검토",
    project: "Daybridge",
    priority: "must",
    state: "ready",
    estimateMinutes: 55,
    dependsOn: ["quest-auth"],
    sourcePath: "C:\\private\\note.md",
    sourceRefs: ["aihub://2026-08-23/quest-plan"],
  });

  assert.deepEqual(candidate, {
    id: "quest-calendar",
    title: "캘린더 연동 설계 검토",
    priority: "must",
    state: "ready",
    estimateMinutes: 55,
    remainingMinutes: 55,
    dependsOn: ["quest-auth"],
    execution: "independent",
    sourceKind: "briefing",
    category: null,
    sourceRefs: ["aihub://2026-08-23/quest-plan"],
  });
  assert.equal("sourcePath" in candidate, false);
});

test("toScheduleTitle turns briefing prose into a short action label", () => {
  assert.equal(toScheduleTitle("고객이 페이지를 강력 새로고침한 후 최신 매입가 카드 1건으로 택배 접수를 다시 시도하고, 관리자 수신·사진 표시·접수번호·상태조회를 한 번 확인해야 한다."), "고객 택배 접수 검증");
  assert.equal(toScheduleTitle("리눅스 학습"), "리눅스 학습");
  assert.equal(toScheduleTitle({ title: "긴 원문", scheduleTitle: "짧은 확인" }), "짧은 확인");
});

test("toTaskCandidate rejects malformed or already-completed quests", () => {
  assert.equal(toTaskCandidate({ id: "missing-title", title: "", estimateMinutes: 25 }), null);
  assert.equal(toTaskCandidate({ id: "done", title: "끝난 작업", state: "completed", estimateMinutes: 25 }), null);
  assert.equal(toTaskCandidate({ id: "bad-estimate", title: "작업", estimateMinutes: -1 }), null);
});

test("createScheduleShell establishes a deterministic Korea-time schedule", () => {
  assert.deepEqual(createScheduleShell({ date: DATE }), {
    schemaVersion: 1,
    date: DATE,
    timezone: "Asia/Seoul",
    generatedAt: "2026-08-24T00:00:00+09:00",
    blocks: [],
    unscheduled: [],
  });
});

test("normalizeSchedule sorts blocks and rejects an overlapping DailySchedule", () => {
  const schedule = normalizeSchedule({
    ...createScheduleShell({ date: DATE }),
    blocks: [
      { id: "focus-later", type: "focus", questId: "q-2", startAt: "2026-08-24T11:00:00+09:00", endAt: "2026-08-24T11:25:00+09:00" },
      { id: "busy-first", type: "busy", startAt: "2026-08-24T09:00:00+09:00", endAt: "2026-08-24T10:00:00+09:00", locked: true },
    ],
  });

  assert.deepEqual(schedule.blocks.map((block) => block.id), ["busy-first", "focus-later"]);
  assert.throws(() => normalizeSchedule({
    ...schedule,
    blocks: [...schedule.blocks, { id: "overlap", type: "buffer", startAt: "2026-08-24T09:50:00+09:00", endAt: "2026-08-24T10:10:00+09:00" }],
  }), /overlap/i);
});

test("normalizeSchedule rejects timestamps outside the scheduled Korea day", () => {
  assert.throws(() => normalizeSchedule({
    ...createScheduleShell({ date: DATE }),
    blocks: [{ id: "wrong-day", type: "busy", startAt: "2026-08-25T09:00:00+09:00", endAt: "2026-08-25T10:00:00+09:00" }],
  }), /date/i);
});
