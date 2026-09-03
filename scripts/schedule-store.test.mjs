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

test("legacy time inputs are stored as title-only defaults", async () => {
  const dataDir = temporaryStore();
  try {
    const settings = await saveScheduleSettings(dataDir, { dayStart: "08:30", dayEnd: "21:30", focusDurations: [25, 50], defaultFocusMinutes: 25, bufferMinutes: 5 });
    assert.deepEqual(await loadScheduleSettings(dataDir), settings);
    assert.equal(settings.defaultFocusMinutes, 50);
    assert.deepEqual(settings.focusDurations, [50]);
    const invalidLegacyHours = await saveScheduleSettings(dataDir, { dayStart: "22:00", dayEnd: "09:00" });
    assert.equal(invalidLegacyHours.timeConfigured, false);
    assert.equal(invalidLegacyHours.dayStart, "");
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

test("legacy and explicit time settings are ignored in title-only mode", async () => {
  const dataDir = temporaryStore();
  try {
    const migrated = await saveScheduleSettings(dataDir, { dayStart: "09:00", dayEnd: "18:00" });
    assert.equal(migrated.timeConfigured, false);
    const explicit = await saveScheduleSettings(dataDir, { dayStart: "09:00", dayEnd: "18:00", timeConfigured: true });
    assert.equal(explicit.timeConfigured, false);
    assert.equal(explicit.dayStart, "");
    assert.equal(explicit.dayEnd, "");
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
    assert.match(result.schedule.blocks[0].reports[0].note, /\[email removed\]/);
    assert.match(result.schedule.blocks[0].reports[0].note, /\[local path\]/);
    await assert.rejects(reportScheduleBlock(dataDir, "2026-08-24", { blockId: "focus-1", status: "blocked" }), /valid block status/);
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
