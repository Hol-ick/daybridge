import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_SCHEDULE_SETTINGS,
  loadSchedule,
  loadScheduleSettings,
  reportScheduleBlock,
  saveSchedule,
  saveScheduleSettings,
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

test("settings persist atomically in the injected data directory", async () => {
  const dataDir = temporaryStore();
  try {
    const settings = await saveScheduleSettings(dataDir, { dayStart: "08:30", dayEnd: "21:30", focusDurations: [25, 50], defaultFocusMinutes: 25, bufferMinutes: 5 });
    assert.deepEqual(await loadScheduleSettings(dataDir), settings);
    assert.equal(settings.defaultFocusMinutes, 50);
    assert.deepEqual(settings.focusDurations, [50]);
    await assert.rejects(saveScheduleSettings(dataDir, { dayStart: "22:00", dayEnd: "09:00" }), /dayStart/);
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
