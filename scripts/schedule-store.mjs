import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCHEDULE_STATUSES = new Set(["planned", "in_progress", "completed", "skipped", "deferred"]);
const CALENDAR_COVERAGE = new Set(["connected", "attention", "stale", "unavailable"]);
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phonePattern = /(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g;
const secretPattern = /(\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret|cookie|session[_ -]?token|private[_ -]?key)\b\s*[:=]\s*)(['"]?)[^\s'"]{8,}/gi;
const localPathPattern = /\b[A-Z]:\\[^\s|]+/gi;

export const DEFAULT_SCHEDULE_SETTINGS = Object.freeze({
  schemaVersion: 1,
  timeZone: "Asia/Seoul",
  dayStart: "09:00",
  dayEnd: "22:00",
  focusDurations: [50],
  defaultFocusMinutes: 50,
  bufferMinutes: 10,
});

function isDate(value) { return DATE.test(value || ""); }
function minutes(value) { const [hour, minute] = String(value).split(":").map(Number); return (hour * 60) + minute; }
function now() { return new Date().toISOString(); }
function sanitizeText(value, limit = 600) {
  const text = String(value || "")
    .replace(emailPattern, "[email removed]")
    .replace(phonePattern, "[phone removed]")
    .replace(secretPattern, "$1[sensitive value removed]")
    .replace(localPathPattern, "[local path]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}
function assertDate(value) {
  if (!isDate(value)) throw new TypeError("date must use YYYY-MM-DD format.");
  return value;
}
async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
function arrayOfPositiveIntegers(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const parsed = [...new Set(value.map(Number).filter((item) => Number.isInteger(item) && item >= 5 && item <= 180))].sort((left, right) => left - right);
  return parsed.length ? parsed : fallback;
}
function normalizeSettings(input = {}) {
  const candidate = input && typeof input === "object" ? input : {};
  const dayStart = TIME.test(candidate.dayStart) ? candidate.dayStart : DEFAULT_SCHEDULE_SETTINGS.dayStart;
  const dayEnd = TIME.test(candidate.dayEnd) ? candidate.dayEnd : DEFAULT_SCHEDULE_SETTINGS.dayEnd;
  if (minutes(dayStart) >= minutes(dayEnd)) throw new TypeError("dayStart must be earlier than dayEnd.");
  // Keep the persisted shape for compatibility, but migrate every old setting
  // to the single user-facing HH:00–HH:50 focus unit.
  const focusDurations = [50];
  const defaultFocusMinutes = 50;
  const requestedBuffer = Number(candidate.bufferMinutes);
  const bufferMinutes = Number.isInteger(requestedBuffer) && requestedBuffer >= 0 && requestedBuffer <= 60 ? requestedBuffer : DEFAULT_SCHEDULE_SETTINGS.bufferMinutes;
  return {
    schemaVersion: 1,
    timeZone: candidate.timeZone === "Asia/Seoul" ? candidate.timeZone : DEFAULT_SCHEDULE_SETTINGS.timeZone,
    dayStart,
    dayEnd,
    focusDurations,
    defaultFocusMinutes,
    bufferMinutes,
  };
}

function sanitizeValue(value, limit = 600) {
  if (typeof value === "string") return sanitizeText(value, limit);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, limit));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    // Calendar event metadata must never become Daybridge persistence or a handoff payload.
    if (/^(calendar|event|attendee|attendees|description|location|organizer|creator|conference|htmlLink|recurrence|reminder)/i.test(key)) continue;
    result[key] = sanitizeValue(item, limit);
  }
  return result;
}
function normalizeBlock(block, index) {
  const source = block && typeof block === "object" ? sanitizeValue(block, 240) : {};
  const id = typeof source.id === "string" && source.id.trim() ? sanitizeText(source.id, 120) : `block-${index + 1}`;
  const status = SCHEDULE_STATUSES.has(source.status) ? source.status : "planned";
  return { ...source, id, status };
}
function normalizeSchedule(date, input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const sourceDate = source.date || source.activityDate || date;
  if (sourceDate !== date) throw new TypeError("schedule date must match the requested date.");
  const coverage = CALENDAR_COVERAGE.has(source.calendar?.coverage) ? source.calendar.coverage : "attention";
  return {
    ...sanitizeValue(source, 600),
    schemaVersion: 1,
    date,
    activityDate: date,
    timeZone: source.timeZone === "Asia/Seoul" ? source.timeZone : DEFAULT_SCHEDULE_SETTINGS.timeZone,
    calendar: { coverage },
    // Calendar input is normalized to anonymous schedule blocks upstream. Never persist the raw busyBlocks input or event metadata here.
    busyBlocks: [],
    blocks: Array.isArray(source.blocks) ? source.blocks.map(normalizeBlock) : [],
    generatedAt: typeof source.generatedAt === "string" ? source.generatedAt : now(),
  };
}

export function schedulePath(dataDir, date) { return join(resolve(dataDir), "schedules", `${assertDate(date)}.json`); }
export function settingsPath(dataDir) { return join(resolve(dataDir), "schedule-settings.json"); }

export async function loadScheduleSettings(dataDir) {
  const stored = await readJson(settingsPath(dataDir));
  try { return normalizeSettings(stored || DEFAULT_SCHEDULE_SETTINGS); } catch { return { ...DEFAULT_SCHEDULE_SETTINGS, focusDurations: [...DEFAULT_SCHEDULE_SETTINGS.focusDurations] }; }
}

export async function saveScheduleSettings(dataDir, settings) {
  const normalized = normalizeSettings(settings);
  await atomicWrite(settingsPath(dataDir), normalized);
  return normalized;
}

export async function loadSchedule(dataDir, date) {
  const requestedDate = assertDate(date);
  const stored = await readJson(schedulePath(dataDir, requestedDate));
  if (!stored) return null;
  try { return normalizeSchedule(requestedDate, stored); } catch { return null; }
}

export async function saveSchedule(dataDir, date, schedule) {
  const requestedDate = assertDate(date);
  const normalized = normalizeSchedule(requestedDate, schedule);
  await atomicWrite(schedulePath(dataDir, requestedDate), normalized);
  return normalized;
}

export async function reportScheduleBlock(dataDir, date, input = {}) {
  const requestedDate = assertDate(date);
  const blockId = typeof input.blockId === "string" ? sanitizeText(input.blockId, 120) : "";
  const status = typeof input.status === "string" ? input.status : "";
  if (!blockId || !SCHEDULE_STATUSES.has(status)) throw new TypeError("blockId and a valid block status are required.");
  const schedule = await loadSchedule(dataDir, requestedDate);
  if (!schedule) return null;
  const index = schedule.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return { schedule: null, report: null };
  const occurredAt = typeof input.occurredAt === "string" && !Number.isNaN(Date.parse(input.occurredAt)) ? input.occurredAt : now();
  const report = {
    id: randomUUID(),
    occurredAt,
    status,
    note: sanitizeText(input.note, 600),
    source: "daybridge",
  };
  const blocks = schedule.blocks.map((block, blockIndex) => blockIndex === index
    ? { ...block, status, updatedAt: occurredAt, reports: [...(Array.isArray(block.reports) ? block.reports : []), report].slice(-20) }
    : block);
  const updated = await saveSchedule(dataDir, requestedDate, { ...schedule, blocks, updatedAt: occurredAt });
  const block = updated.blocks.find((item) => item.id === blockId);
  return { schedule: updated, report: { ...report, block: { id: block.id, taskId: sanitizeText(block.taskId || block.questId, 120), title: sanitizeText(block.title, 180), status: block.status } } };
}
