import assert from "node:assert/strict";
import test from "node:test";

import { FOCUS_UNIT_MINUTES, validateQuestPlan } from "./input-contract.js";

const base = {
  artifact_type: "daybridge_quest_plan",
  schema_version: "1.1",
  source_date: "2026-08-25",
  schedule_date: "2026-08-26",
  status: "ready",
  source: { coverage: "complete", quality: "aligned", refs: ["aihub://2026-08-25/closeout"] },
};

function quest(overrides = {}) {
  return {
    id: "q-linux",
    title: "리눅스 학습",
    schedule_title: "리눅스 학습",
    actor: "user",
    kind: "execute",
    priority: "must",
    state: "ready",
    execution: "independent",
    focus_units: 1,
    remaining_units: 1,
    first_action: "실습 환경을 연다",
    done_when: "학습 결과를 기록한다",
    source_refs: ["aihub://2026-08-25/closeout#linux"],
    ...overrides,
  };
}

test("canonical quest plan accepts focus units and keeps the schedule boundary small", () => {
  const result = validateQuestPlan({ ...base, quests: [quest()] }, { sourceDate: base.source_date, targetDate: base.schedule_date });

  assert.equal(result.valid, true);
  assert.equal(result.status, "accepted");
  assert.equal(result.accepted[0].focus_units, 1);
  assert.equal(result.accepted[0].focus_units * FOCUS_UNIT_MINUTES, 50);
  assert.deepEqual(result.reviewQueue, []);
  assert.deepEqual(result.excluded, []);
});

test("confirmation questions never become executable quests", () => {
  const result = validateQuestPlan({ ...base, quests: [quest({ id: "q-question", requires_confirmation: true, question: "이 일정이 실제 약속인가?" })], confirmation_questions: ["캘린더를 확인할까?"] });

  assert.equal(result.accepted.length, 0);
  assert.equal(result.reviewQueue.length, 2);
  assert.equal(result.status, "attention");
  assert.equal(result.reviewQueue[0].reason, "needs_user_confirmation");
});

test("legacy estimate minutes are rounded up to fixed focus units with a warning", () => {
  const result = validateQuestPlan({ ...base, schema_version: "1.0", quests: [quest({ focus_units: undefined, remaining_units: undefined, estimate_minutes: 75, remaining_minutes: 25 })] });

  assert.equal(result.valid, true);
  assert.equal(result.accepted[0].focus_units, 2);
  assert.equal(result.accepted[0].remaining_units, 1);
  assert.ok(result.warnings.some((warning) => /legacy estimate_minutes/.test(warning)));
});

test("schema 1.1 rejects a quest without an explicit focus unit count", () => {
  const result = validateQuestPlan({ ...base, quests: [quest({ focus_units: undefined, remaining_units: undefined })] });

  assert.equal(result.valid, true);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.excluded[0].reason, "missing_focus_units");
});

test("fixed clock fields are excluded because Calendar owns time constraints", () => {
  const result = validateQuestPlan({ ...base, quests: [quest({ start_at: "2026-08-26T09:00:00+09:00", end_at: "2026-08-26T09:50:00+09:00" })] });

  assert.equal(result.accepted.length, 0);
  assert.equal(result.excluded[0].reason, "fixed_time_not_allowed");
});

test("blocked packets are rejected without accepted work", () => {
  const result = validateQuestPlan({ ...base, status: "blocked", quests: [quest()] });

  assert.equal(result.valid, false);
  assert.equal(result.status, "rejected");
  assert.equal(result.accepted.length, 1);
  assert.ok(result.errors.some((error) => /blocked packet/.test(error)));
});
