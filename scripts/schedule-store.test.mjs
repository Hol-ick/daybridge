import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_SCHEDULE_SETTINGS,
  DEFAULT_DAILY_DEFAULTS,
  discardScheduleBlock,
  dailyDefaultsPath,
  loadDailyDefaults,
  loadSchedule,
  loadScheduleSettings,
  reportScheduleBlock,
  saveSchedule,
  saveScheduleSettings,
  saveDailyDefaults,
  schedulePath,
} from "./schedule-store.mjs";

function temporaryStore() { return mkdtempSync(join(tmpdir(), "daybridge-schedule-store-")); }
function remove(path) { rmSync(path, { recursive: true, force: true }); }

test("new stores return the scheduling defaults", async () => {
  const dataDir = temporaryStore();
  try {
    assert.deepEqual(await loadScheduleSettings(dataDir), DEFAULT_SCHEDULE_SETTINGS);
    assert.equal(await loadSchedule(dataDir, "2026-08-24"), null);
  } finally { remove(dataDir); }
});

test("daily defaults load the safe starter routine and persist user edits locally", async () => {
  const dataDir = temporaryStore();
  try {
    assert.deepEqual(await loadDailyDefaults(dataDir), DEFAULT_DAILY_DEFAULTS);
    const saved = await saveDailyDefaults(dataDir, {
      routines: [
        { id: "mail", title: "오전 메일 확인", days: [1, 2, 3, 4, 5], enabled: true },
        { id: "off", title: "주간 정리", days: [1, 3], enabled: false, estimateMinutes: 50 },
      ],
    });
    assert.deepEqual(saved.routines.map(({ id, title, enabled, days }) => ({ id, title, enabled, days })), [
      { id: "mail", title: "오전 메일 확인", enabled: true, days: [1, 2, 3, 4, 5] },
      { id: "off", title: "주간 정리", enabled: false, days: [1, 3] },
    ]);
    assert.deepEqual(await loadDailyDefaults(dataDir), saved);
    assert.equal(readFileSync(dailyDefaultsPath(dataDir), "utf8").includes("오전 메일 확인"), true);
    await saveDailyDefaults(dataDir, { routines: [] });
    assert.deepEqual(await loadDailyDefaults(dataDir), { schemaVersion: 1, routines: [] });
  } finally { remove(dataDir); }
});

test("time settings preserve explicit work hours and normalize focus units", async () => {
  const dataDir = temporaryStore();
  try {
    const settings = await saveScheduleSettings(dataDir, { dayStart: "08:30", dayEnd: "21:30", focusDurations: [25, 50], defaultFocusMinutes: 25, bufferMinutes: 5 });
    assert.deepEqual(await loadScheduleSettings(dataDir), settings);
    assert.equal(settings.defaultFocusMinutes, 50);
    assert.deepEqual(settings.focusDurations, [50]);
    await assert.rejects(() => saveScheduleSettings(dataDir, { dayStart: "22:00", dayEnd: "09:00", timeConfigured: true }));
  } finally { remove(dataDir); }
});

test("empty time settings keep the store in lightweight todo-list mode", async () => {
  const dataDir = temporaryStore();
  try {
    const settings = await saveScheduleSettings(dataDir, { dayStart: "", dayEnd: "", bufferMinutes: 10 });
    assert.equal(settings.dayStart, "");
    assert.equal(settings.dayEnd, "");
    assert.equal(settings.timeConfigured, false);
    assert.deepEqual(await loadScheduleSettings(dataDir), settings);
  } finally { remove(dataDir); }
});

test("explicit time settings enable timed mode while blank settings stay untimed", async () => {
  const dataDir = temporaryStore();
  try {
    const migrated = await saveScheduleSettings(dataDir, { dayStart: "09:00", dayEnd: "18:00" });
    assert.equal(migrated.timeConfigured, false);
    assert.equal(migrated.dayStart, "");
    assert.equal(migrated.dayEnd, "");
    const explicit = await saveScheduleSettings(dataDir, { dayStart: "09:00", dayEnd: "18:00", timeConfigured: true });
    assert.equal(explicit.timeConfigured, true);
    assert.equal(explicit.dayStart, "09:00");
    assert.equal(explicit.dayEnd, "18:00");
  } finally { remove(dataDir); }
});

test("schedule persistence removes calendar metadata and never saves busy event ranges", async () => {
  const dataDir = temporaryStore();
  try {
    const saved = await saveSchedule(dataDir, "2026-08-24", {
      date: "2026-08-24",
      calendar: { coverage: "connected", description: "private event" },
      busyBlocks: [{ id: "calendar-event", start: "2026-08-24T10:00:00+09:00", end: "2026-08-24T11:00:00+09:00", title: "private" }],
      blocks: [{ id: "focus-1", kind: "focus", taskId: "quest-1", title: "Write a safe note", start: "2026-08-24T09:00:00+09:00", end: "2026-08-24T09:25:00+09:00", calendarEvent: { title: "must not persist" } }],
    });
    assert.deepEqual(saved.busyBlocks, []);
    assert.deepEqual(saved.calendar, { coverage: "connected" });
    assert.equal(saved.blocks[0].calendarEvent, undefined);
    const exact = JSON.parse(readFileSync(schedulePath(dataDir, "2026-08-24"), "utf8"));
    assert.deepEqual(exact.busyBlocks, []);
    assert.equal(JSON.stringify(exact).includes("private event"), false);
    assert.deepEqual(await loadSchedule(dataDir, "2026-08-24"), saved);
  } finally { remove(dataDir); }
});

test("block reports only accept explicit schedule states and preserve a sanitized receipt", async () => {
  const dataDir = temporaryStore();
  try {
    await saveSchedule(dataDir, "2026-08-24", { date: "2026-08-24", blocks: [{ id: "focus-1", taskId: "quest-1", title: "Draft the handoff", status: "planned" }] });
    const result = await reportScheduleBlock(dataDir, "2026-08-24", { blockId: "focus-1", status: "completed", note: "Sent to test@example.com from C:\\private\\note" });
    assert.equal(result.schedule.blocks[0].status, "completed");
    assert.equal(result.report.block.taskId, "quest-1");
    assert.equal(result.autoStarted, null);
    assert.match(result.schedule.blocks[0].reports[0].note, /\[email removed\]/);
    assert.match(result.schedule.blocks[0].reports[0].note, /\[local path\]/);
    await assert.rejects(reportScheduleBlock(dataDir, "2026-08-24", { blockId: "focus-1", status: "blocked" }), /valid block status/);
  } finally { remove(dataDir); }
});

test("completing an in-progress focus block starts the next planned focus block and preserves both receipts", async () => {
  const dataDir = temporaryStore();
  try {
    await saveSchedule(dataDir, "2026-08-24", {
      date: "2026-08-24",
      mode: "todo",
      timeConfigured: false,
      blocks: [
        { id: "focus-active", type: "focus", taskId: "quest-active", title: "현재 작업", status: "in_progress", order: 0 },
        { id: "focus-deferred", type: "focus", taskId: "quest-deferred", title: "보류 작업", status: "deferred", order: 1 },
        { id: "focus-next", type: "focus", taskId: "quest-next", title: "다음 작업", status: "planned", order: 2 },
        { id: "focus-later", type: "focus", taskId: "quest-later", title: "나중 작업", status: "planned", order: 3 },
      ],
    });
    const result = await reportScheduleBlock(dataDir, "2026-08-24", { blockId: "focus-active", status: "completed", note: "완료" });
    assert.equal(result.schedule.blocks.find((block) => block.id === "focus-active").status, "completed");
    assert.equal(result.schedule.blocks.find((block) => block.id === "focus-next").status, "in_progress");
    assert.equal(result.schedule.blocks.find((block) => block.id === "focus-later").status, "planned");
    assert.equal(result.autoStarted.block.id, "focus-next");
    assert.equal(result.autoStarted.source, "daybridge_auto_start");
    assert.equal(result.schedule.blocks.find((block) => block.id === "focus-active").reports.at(-1).status, "completed");
    assert.equal(result.schedule.blocks.find((block) => block.id === "focus-next").reports.at(-1).status, "in_progress");
    assert.equal((await loadSchedule(dataDir, "2026-08-24")).blocks.find((block) => block.id === "focus-next").status, "in_progress");
  } finally { remove(dataDir); }
});

test("completing a focus block never auto-starts another task while a different task is already in progress", async () => {
  const dataDir = temporaryStore();
  try {
    await saveSchedule(dataDir, "2026-08-24", {
      date: "2026-08-24",
      mode: "todo",
      timeConfigured: false,
      blocks: [
        { id: "focus-completing", type: "focus", taskId: "quest-completing", title: "완료할 작업", status: "in_progress", order: 0 },
        { id: "focus-existing", type: "focus", taskId: "quest-existing", title: "이미 진행 중인 작업", status: "in_progress", order: 1 },
        { id: "focus-next", type: "focus", taskId: "quest-next", title: "다음 작업", status: "planned", order: 2 },
      ],
    });
    const result = await reportScheduleBlock(dataDir, "2026-08-24", { blockId: "focus-completing", status: "completed", note: "완료" });
    assert.equal(result.schedule.blocks.find((block) => block.id === "focus-completing").status, "completed");
    assert.equal(result.schedule.blocks.find((block) => block.id === "focus-existing").status, "in_progress");
    assert.equal(result.schedule.blocks.find((block) => block.id === "focus-next").status, "planned");
    assert.equal(result.autoStarted, null);
  } finally { remove(dataDir); }
});

test("discarding an open focus block removes one schedule unit and persists a sanitized receipt", async () => {
  const dataDir = temporaryStore();
  try {
    await saveSchedule(dataDir, "2026-08-24", {
      date: "2026-08-24",
      blocks: [
        { id: "focus-1", type: "focus", questId: "quest-1", title: "리눅스 학습", status: "planned", startAt: "2026-08-24T09:00:00+09:00", endAt: "2026-08-24T09:50:00+09:00" },
        { id: "focus-2", type: "focus", questId: "quest-1", title: "리눅스 학습", status: "planned", startAt: "2026-08-24T10:00:00+09:00", endAt: "2026-08-24T10:50:00+09:00" },
      ],
    });
    const result = await discardScheduleBlock(dataDir, "2026-08-24", { blockId: "focus-1" });
    assert.deepEqual(result.schedule.blocks.map((block) => block.id), ["focus-2"]);
    assert.deepEqual(result.schedule.discardedBlocks.map((item) => ({ blockId: item.blockId, questId: item.questId, units: item.units })), [{ blockId: "focus-1", questId: "quest-1", units: 1 }]);
    assert.equal((await loadSchedule(dataDir, "2026-08-24")).discardedBlocks[0].title, "리눅스 학습");
  } finally { remove(dataDir); }
});
