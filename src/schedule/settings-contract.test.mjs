import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScheduleSettings, DEFAULT_MEALS } from "./settings-contract.js";
import { getAvailableFocusSlots } from "./scheduler.js";

const timed = { dayStart: "09:00", dayEnd: "18:00", timeConfigured: true };
test("shared settings validate both times, actual clock ranges and buffer boundaries", () => {
  for (const bufferMinutes of [0, 30]) assert.equal(normalizeScheduleSettings({ ...timed, bufferMinutes }).bufferMinutes, bufferMinutes);
  for (const bufferMinutes of [31, 45, 60, null, true, "", -1, 2.5]) assert.throws(() => normalizeScheduleSettings({ ...timed, bufferMinutes }));
  for (const input of [{ dayStart: "09:00" }, { dayEnd: "18:00" }, { dayStart: "25:00", dayEnd: "26:00" }, { timeConfigured: true }, { ...timed, dayEnd: "08:00" }]) assert.throws(() => normalizeScheduleSettings(input));
  assert.equal(normalizeScheduleSettings({}).timeConfigured, false);
  assert.deepEqual(normalizeScheduleSettings({}).breaks, []);
});
test("explicit breaks stay authoritative and unspecified breaks use lunch", () => {
  const empty = normalizeScheduleSettings({ ...timed, breaks: [] });
  assert.deepEqual(empty.breaks, []);
  assert.deepEqual(normalizeScheduleSettings(empty), empty);
  assert.deepEqual(normalizeScheduleSettings(timed).breaks, [{ start: "11:30", end: "13:00", label: "점심시간" }]);
  const custom = normalizeScheduleSettings({ ...timed, breaks: [{ start: "10:00", end: "10:30" }, { start: "15:00", end: "15:30" }] });
  assert.deepEqual(normalizeScheduleSettings(custom), custom);
});
test("enabled meals define breaks and overlapping ranges do not free occupied slots", () => {
  const off = Object.fromEntries(Object.entries(DEFAULT_MEALS).map(([key, meal]) => [key, { ...meal, enabled: false }]));
  assert.deepEqual(normalizeScheduleSettings({ ...timed, meals: off }).breaks, []);
  const settings = normalizeScheduleSettings({ ...timed, breaks: [], meals: { ...off, breakfast: { enabled: true, start: "11:00", end: "12:00" }, lunch: { enabled: true, start: "11:30", end: "13:00" } } });
  const slots = getAvailableFocusSlots({ date: "2099-01-05", settings });
  assert.ok(!slots.some(slot => /T1[12]:00:/.test(slot.startAt)));
  assert.ok(slots.some(slot => slot.startAt.includes("T13:00:")));
  assert.throws(() => normalizeScheduleSettings({ ...timed, meals: { lunch: { start: "wrong" } } }));
});
