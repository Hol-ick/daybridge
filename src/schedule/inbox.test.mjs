import test from "node:test";
import assert from "node:assert/strict";

import { parseScheduleInboxMarkdown } from "./inbox.js";

const inbox = (rows) => `---
artifact_type: daybridge_schedule_inbox
schema_version: "1"
schedule_date: 2026-08-27
timezone: Asia/Seoul
updated_at: 2026-08-27T09:00:00+09:00
---

# Daybridge 일정 입력

| id | title | focus_units | remaining_units | state | priority | execution | depends_on | first_action | done_when | source_refs |
|---|---|---:|---:|---|---|---|---|---|---|---|
${rows.join("\n")}
`;

test("parses executable inbox rows into 50-minute candidates", () => {
  const parsed = parseScheduleInboxMarkdown(inbox([
    "| path-check | 옛 KTH 경로 확인 | 1 | 1 | ready | must | independent |  | 설정에서 검색 | 결과 기록 | aihub://reports/daily/2026-08-13 |",
    "| follow-up | 배포 상태 확인 | 2 | 1 | deferred | should | sequential | path-check | 배포 화면 열기 | 상태 기록 | |",
  ]), { date: "2026-08-27" });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.tasks.length, 2);
  assert.deepEqual(parsed.tasks[0], {
    id: "path-check", questId: "path-check", title: "옛 KTH 경로 확인", scheduleTitle: "옛 KTH 경로 확인", displayTitle: "옛 KTH 경로 확인",
    priority: "must", state: "ready", status: "ready", execution: "independent", dependsOn: [], focusUnits: 1, remainingUnits: 1,
    estimateMinutes: 50, durationMinutes: 50, remainingMinutes: 50, currentAction: "설정에서 검색", firstStep: "설정에서 검색", doneWhen: "결과 기록",
    sourceKind: "briefing", sourceLabel: "AIHUB 일정 inbox", sourceRefs: ["aihub://reports/daily/2026-08-13"],
  });
  assert.deepEqual(parsed.tasks[1].dependsOn, ["path-check"]);
  assert.equal(parsed.tasks[1].remainingMinutes, 50);
});

test("excludes blocked, malformed, and fixed-time rows without making the packet invalid", () => {
  const parsed = parseScheduleInboxMarkdown(inbox([
    "| blocked-task | 차단된 작업 | 1 | 1 | blocked | must | independent |  |  |  | |",
    "| bad-task | 잘못된 작업 | 2 | 3 | ready | should | independent |  |  |  | |",
  ]), { date: "2026-08-27" });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.tasks.length, 0);
  assert.equal(parsed.excluded.length, 2);
  assert.match(parsed.excluded[0].reason, /state/);
  assert.match(parsed.excluded[1].reason, /remaining_units/);
});

test("rejects wrong date, timezone, schema, and table shape", () => {
  const parsed = parseScheduleInboxMarkdown(inbox([
    "| path-check | 확인 | 1 | 1 | ready | should | independent |  |  |  | |",
  ]).replace("schedule_date: 2026-08-27", "schedule_date: 2026-08-28").replace("timezone: Asia/Seoul", "timezone: UTC"), { date: "2026-08-27" });

  assert.equal(parsed.valid, false);
  assert.equal(parsed.tasks.length, 1);
  assert.match(parsed.errors.join(" "), /요청 날짜/);
  assert.match(parsed.errors.join(" "), /timezone/);
});

test("excludes a row that smuggles a clock time into its title", () => {
  const parsed = parseScheduleInboxMarkdown(inbox([
    "| timed | 09:00 회의 준비 | 1 | 1 | ready | must | independent |  |  |  | |",
  ]), { date: "2026-08-27" });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.tasks.length, 0);
  assert.match(parsed.excluded[0].reason, /고정 시각/);
});

test("excludes rows that contain machine paths in source references", () => {
  const parsed = parseScheduleInboxMarkdown(inbox([
    "| unsafe | 경로 확인 | 1 | 1 | ready | should | independent |  |  |  | C:\\\\private\\\\note.md |",
  ]), { date: "2026-08-27" });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.tasks.length, 0);
  assert.match(parsed.excluded[0].reason, /source_refs/);
});
