import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startFixtureBridge } from "./test-support/fixture-bridge.mjs";
import { saveScheduleSettings, loadScheduleSettings, settingsPath } from "./schedule-store.mjs";
import { getAvailableFocusSlots } from "../src/schedule/scheduler.js";

const hours = { dayStart: "09:00", dayEnd: "15:00", timeConfigured: true };

test("invalid buffers are rejected before changing the saved settings", async () => {
  const f = await startFixtureBridge();
  try {
    await saveScheduleSettings(f.dataDir, hours);
    const before = await readFile(settingsPath(f.dataDir));
    for (const bufferMinutes of [31, 45, 60, -1, 1.5, "invalid"]) {
      await assert.rejects(() => saveScheduleSettings(f.dataDir, { ...hours, bufferMinutes }));
      assert.deepEqual(await readFile(settingsPath(f.dataDir)), before);
    }
    for (const bufferMinutes of [0, 30]) {
      const saved = await saveScheduleSettings(f.dataDir, { ...hours, bufferMinutes });
      assert.equal(saved.bufferMinutes, bufferMinutes);
      assert.doesNotThrow(() => getAvailableFocusSlots({ date: "2099-01-05", settings: saved }));
    }
  } finally { await f.close(); }
});

test("an explicit empty break list survives storage and allows the noon slot", async () => {
  const f = await startFixtureBridge();
  try {
    const saved = await saveScheduleSettings(f.dataDir, { ...hours, breaks: [] });
    assert.deepEqual(saved.breaks, []);
    assert.deepEqual((await loadScheduleSettings(f.dataDir)).breaks, []);
    const slots = getAvailableFocusSlots({ date: "2099-01-05", settings: saved });
    assert.ok(slots.some(slot => slot.startAt.includes("T12:00:")));
  } finally { await f.close(); }
});

test("legacy out-of-range settings raise invalid_settings and preserve the original", async () => {
  const f = await startFixtureBridge();
  try {
    const text = JSON.stringify({ ...hours, bufferMinutes: 45 });
    await writeFile(settingsPath(f.dataDir), text);
    await assert.rejects(() => loadScheduleSettings(f.dataDir), { code: "invalid_settings" });
    assert.equal(await readFile(settingsPath(f.dataDir), "utf8"), text);
  } finally { await f.close(); }
});

test("settings API preserves state on invalid input and commits rebuilt schedules with valid settings", async () => {
  const f = await startFixtureBridge();
  const activityDate = "2099-01-05";
  try {
    assert.equal((await f.request("PUT", "/api/schedule-settings", { ...hours, activityDate })).status, 200);
    const path = settingsPath(f.dataDir);
    const schedulePath = join(f.dataDir, "schedules", `${activityDate}.json`);
    const settingsBefore = await readFile(path);
    const scheduleBefore = await readFile(schedulePath);
    const invalid = await f.request("PUT", "/api/schedule-settings", { activityDate, bufferMinutes: 45 });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "invalid_settings");
    assert.deepEqual(await readFile(path), settingsBefore);
    assert.deepEqual(await readFile(schedulePath), scheduleBefore);
    const valid = await f.request("PUT", "/api/schedule-settings", { activityDate, breaks: [] });
    assert.equal(valid.status, 200);
    assert.deepEqual(valid.body.settings.breaks, []);
    assert.deepEqual(JSON.parse(await readFile(schedulePath, "utf8")), valid.body.schedule);
    await writeFile(path, JSON.stringify({ ...hours, bufferMinutes: 60 }));
    assert.equal((await f.request("GET", "/api/schedule-settings")).body.code, "invalid_settings");
    const corrected = await f.request("PUT", "/api/schedule-settings", { ...hours, bufferMinutes: 30, activityDate, breaks: [] });
    assert.equal(corrected.status, 200);
    assert.equal((await loadScheduleSettings(f.dataDir)).bufferMinutes, 30);
  } finally { await f.close(); }
});

test("a rebuild failure rolls back the staged settings and keeps the prior schedule", async () => {
  const f = await startFixtureBridge();
  const activityDate = "2099-01-05";
  try {
    assert.equal((await f.request("PUT", "/api/schedule-settings", { ...hours, activityDate })).status, 200);
    const path = settingsPath(f.dataDir);
    const schedulePath = join(f.dataDir, "schedules", `${activityDate}.json`);
    const before = await readFile(path);
    const scheduleBefore = await readFile(schedulePath);
    await writeFile(schedulePath, "{damaged");
    const result = await f.request("PUT", "/api/schedule-settings", { activityDate, bufferMinutes: 0 });
    assert.equal(result.status, 500);
    assert.equal(result.body.code, "corrupt_json");
    assert.deepEqual(await readFile(path), before);
    assert.equal(await readFile(schedulePath, "utf8"), "{damaged");
    await writeFile(schedulePath, scheduleBefore);
  } finally { await f.close(); }
});
