import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getAvailableFocusSlots } from "../src/schedule/scheduler.js";

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
  dayStart: "",
  dayEnd: "",
  timeConfigured: false,
  focusDurations: [50],
  defaultFocusMinutes: 50,
  bufferMinutes: 10,
});

export const DEFAULT_DAILY_DEFAULTS = Object.freeze({
  schemaVersion: 1,
  routines: Object.freeze([
    Object.freeze({ id: "supplement", title: "영양제 먹기", estimateMinutes: 25, days: Object.freeze([0, 1, 2, 3, 4, 5, 6]), enabled: true }),
  ]),
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
  const rawStart = typeof candidate.dayStart === "string" ? candidate.dayStart.trim() : "";
  const rawEnd = typeof candidate.dayEnd === "string" ? candidate.dayEnd.trim() : "";
  // Settings written by versions before the optional-time mode used 09:00–18:00
  // as an implicit default. Treat that exact legacy shape as unconfigured; a
  // user can still explicitly opt into those hours by saving timeConfigured.
  const legacyImplicitDefault = !Object.hasOwn(candidate, "timeConfigured") && rawStart === "09:00" && rawEnd === "18:00";
  const timeConfigured = candidate.timeConfigured === true || (!Object.hasOwn(candidate, "timeConfigured") && !legacyImplicitDefault && TIME.test(rawStart) && TIME.test(rawEnd));
  const dayStart = timeConfigured && TIME.test(rawStart) ? rawStart : "";
  const dayEnd = timeConfigured && TIME.test(rawEnd) ? rawEnd : "";
  if (timeConfigured && (!TIME.test(dayStart) || !TIME.test(dayEnd))) throw new TypeError("dayStart and dayEnd must both be set, or both be empty.");
  if (timeConfigured && minutes(dayStart) >= minutes(dayEnd)) throw new TypeError("dayStart must be earlier than dayEnd.");
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
    timeConfigured,
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
function normalizeDiscardedBlocks(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    blockId: typeof item?.blockId === "string" ? sanitizeText(item.blockId, 120) : "",
    questId: typeof item?.questId === "string" ? sanitizeText(item.questId, 120) : "",
    title: typeof item?.title === "string" ? sanitizeText(item.title, 180) : "",
    units: Number.isInteger(item?.units) && item.units > 0 ? Math.min(item.units, 10) : 1,
    discardedAt: typeof item?.discardedAt === "string" && !Number.isNaN(Date.parse(item.discardedAt)) ? item.discardedAt : now(),
  })).filter((item) => item.blockId && item.questId).slice(-200);
}
function normalizeSchedule(date, input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const sourceDate = source.date || source.activityDate || date;
  if (sourceDate !== date) throw new TypeError("schedule date must match the requested date.");
  const coverage = CALENDAR_COVERAGE.has(source.calendar?.coverage) ? source.calendar.coverage : "attention";
  const sanitized = sanitizeValue(source, 600);
  delete sanitized.timeZone;
  return {
    ...sanitized,
    schemaVersion: 1,
    date,
    activityDate: date,
    timezone: (source.timezone === "Asia/Seoul" || source.timeZone === "Asia/Seoul") ? "Asia/Seoul" : DEFAULT_SCHEDULE_SETTINGS.timeZone,
    calendar: { coverage },
    // Calendar input is normalized to anonymous schedule blocks upstream. Never persist the raw busyBlocks input or event metadata here.
    busyBlocks: [],
    blocks: Array.isArray(source.blocks) ? source.blocks.map(normalizeBlock) : [],
    discardedBlocks: normalizeDiscardedBlocks(source.discardedBlocks),
    generatedAt: typeof source.generatedAt === "string" ? source.generatedAt : now(),
  };
}

export function schedulePath(dataDir, date) { return join(resolve(dataDir), "schedules", `${assertDate(date)}.json`); }
export function settingsPath(dataDir) { return join(resolve(dataDir), "schedule-settings.json"); }
export function dailyDefaultsPath(dataDir) { return join(resolve(dataDir), "daily-defaults.json"); }

function normalizeDailyDefault(raw, index) {
  const candidate = raw && typeof raw === "object" ? raw : {};
  const id = sanitizeText(candidate.id || `daily-${index + 1}`, 80).toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "");
  const title = sanitizeText(candidate.title, 120);
  const estimateMinutes = Number(candidate.estimateMinutes) === 50 ? 50 : 25;
  const days = [...new Set((Array.isArray(candidate.days) ? candidate.days : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((left, right) => left - right);
  if (!id || !title || !days.length) return null;
  return { id, title, estimateMinutes, days, enabled: candidate.enabled !== false };
}

function normalizeDailyDefaults(input) {
  const raw = Array.isArray(input) ? input : input?.routines;
  const routines = (Array.isArray(raw) ? raw : []).slice(0, 50).map(normalizeDailyDefault).filter(Boolean);
  const seen = new Set();
  return {
    schemaVersion: 1,
    routines: routines.filter((routine) => {
      const key = routine.title.toLocaleLowerCase("ko-KR");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

export async function loadDailyDefaults(dataDir) {
  const stored = await readJson(dailyDefaultsPath(dataDir));
  const normalized = normalizeDailyDefaults(stored);
  if (Array.isArray(stored) || Array.isArray(stored?.routines)) return normalized;
  return { schemaVersion: 1, routines: DEFAULT_DAILY_DEFAULTS.routines.map((routine) => ({ ...routine, days: [...routine.days] })) };
}

export async function saveDailyDefaults(dataDir, input) {
  const normalized = normalizeDailyDefaults(input);
  await atomicWrite(dailyDefaultsPath(dataDir), normalized);
  return normalized;
}

export async function loadScheduleSettings(dataDir) {
  const stored = await readJson(settingsPath(dataDir));
  try {
    const normalized = normalizeSettings(stored || DEFAULT_SCHEDULE_SETTINGS);
    return { ...normalized, dayStart: "", dayEnd: "", timeConfigured: false };
  } catch { return { ...DEFAULT_SCHEDULE_SETTINGS, focusDurations: [...DEFAULT_SCHEDULE_SETTINGS.focusDurations] }; }
}

export async function saveScheduleSettings(dataDir, settings) {
  const normalized = normalizeSettings({ ...(settings || {}), dayStart: "", dayEnd: "", timeConfigured: false });
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

export async function moveScheduleBlock(dataDir, date, input = {}) {
  const requestedDate = assertDate(date);
  const blockId = typeof input.blockId === "string" ? sanitizeText(input.blockId, 120) : "";
  const targetBlockId = typeof input.targetBlockId === "string" && input.targetBlockId.trim() ? sanitizeText(input.targetBlockId, 120) : "";
  const position = input.position === "after" ? "after" : input.position === "before" ? "before" : "";
  if (!blockId || (targetBlockId && targetBlockId === blockId) || (targetBlockId && !position)) throw new TypeError("blockId, targetBlockId, and position must describe a valid move.");
  const schedule = await loadSchedule(dataDir, requestedDate);
  if (!schedule) return null;
  const source = schedule.blocks.find((block) => block.id === blockId);
  if (!source) return { schedule: null, movement: null };
  const terminal = new Set(["completed", "deferred", "skipped"]);
  if (source.type !== "focus" || terminal.has(source.status)) throw new TypeError("Only an open focus block can be moved.");
  const target = targetBlockId ? schedule.blocks.find((block) => block.id === targetBlockId) : null;
  if (targetBlockId && (!target || target.type !== "focus" || terminal.has(target.status))) throw new TypeError("The drop target must be another open focus block.");

  const occurredAt = now();
  const settings = await loadScheduleSettings(dataDir);
  if (!settings.timeConfigured || schedule.mode === "todo" || schedule.timeConfigured === false) {
    const ordered = schedule.blocks
      .filter((block) => block.type === "focus")
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    const orderedSourceIndex = ordered.findIndex((block) => block.id === blockId);
    if (orderedSourceIndex < 0) throw new TypeError("The focus block cannot be moved.");
    const [picked] = ordered.splice(orderedSourceIndex, 1);
    if (!targetBlockId) ordered.push(picked);
    else {
      const targetIndex = ordered.findIndex((block) => block.id === targetBlockId);
      if (targetIndex < 0) throw new TypeError("The drop target is not movable.");
      ordered.splice(targetIndex + (position === "after" ? 1 : 0), 0, picked);
    }
    const orderById = new Map(ordered.map((block, index) => [block.id, index]));
    const blocks = schedule.blocks.map((block) => orderById.has(block.id)
      ? { ...block, order: orderById.get(block.id), locked: true, userPositioned: true, updatedAt: occurredAt }
      : block);
    const updated = await saveSchedule(dataDir, requestedDate, { ...schedule, blocks, updatedAt: occurredAt });
    const moved = updated.blocks.find((block) => block.id === blockId);
    return {
      schedule: updated,
      movement: {
        id: randomUUID(),
        occurredAt,
        sourceBlockId: blockId,
        targetBlockId: targetBlockId || null,
        position: targetBlockId ? position : "end",
        block: { id: moved.id, questId: sanitizeText(moved.questId, 120), title: sanitizeText(moved.title, 180) },
      },
    };
  }
  const movable = schedule.blocks.filter((block) => block.type === "focus" && !terminal.has(block.status))
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || left.id.localeCompare(right.id));
  const sourceIndex = movable.findIndex((block) => block.id === blockId);
  if (sourceIndex < 0) throw new TypeError("The focus block cannot be moved.");
  const [picked] = movable.splice(sourceIndex, 1);
  if (!targetBlockId) movable.push(picked);
  else {
    const targetIndex = movable.findIndex((block) => block.id === targetBlockId);
    if (targetIndex < 0) throw new TypeError("The drop target is not movable.");
    movable.splice(targetIndex + (position === "after" ? 1 : 0), 0, picked);
  }

  const slots = getAvailableFocusSlots({
    date: requestedDate,
    settings,
    busyBlocks: schedule.blocks.filter((block) => block.type === "busy"),
    focusBlocks: schedule.blocks.filter((block) => block.type === "focus" && terminal.has(block.status)),
  });
  if (slots.length < movable.length) throw new RangeError("There are not enough work-hour focus slots for this move.");
  const movedById = new Map(movable.map((block, index) => [block.id, { ...block, ...slots[index], locked: true, userPositioned: true, updatedAt: occurredAt }]));
  const blocks = schedule.blocks.map((block) => movedById.get(block.id) || block);
  const updated = await saveSchedule(dataDir, requestedDate, { ...schedule, blocks, updatedAt: occurredAt });
  const moved = updated.blocks.find((block) => block.id === blockId);
  return {
    schedule: updated,
    movement: {
      id: randomUUID(),
      occurredAt,
      sourceBlockId: blockId,
      targetBlockId: targetBlockId || null,
      position: targetBlockId ? position : "end",
      block: { id: moved.id, questId: sanitizeText(moved.questId, 120), title: sanitizeText(moved.title, 180), startAt: moved.startAt, endAt: moved.endAt },
    },
  };
}

export async function discardScheduleBlock(dataDir, date, input = {}) {
  const requestedDate = assertDate(date);
  const blockId = typeof input.blockId === "string" ? sanitizeText(input.blockId, 120) : "";
  if (!blockId) throw new TypeError("blockId is required to discard a schedule block.");
  const schedule = await loadSchedule(dataDir, requestedDate);
  if (!schedule) return null;
  const source = schedule.blocks.find((block) => block.id === blockId);
  if (!source) return { schedule: null, discard: null };
  const terminal = new Set(["completed", "deferred", "skipped"]);
  if (source.type !== "focus" || terminal.has(source.status)) throw new TypeError("Only an open focus block can be discarded.");
  const discardedAt = now();
  const discard = {
    blockId: source.id,
    questId: sanitizeText(source.questId, 120),
    title: sanitizeText(source.title, 180),
    units: 1,
    discardedAt,
  };
  const updated = await saveSchedule(dataDir, requestedDate, {
    ...schedule,
    blocks: schedule.blocks.filter((block) => block.id !== blockId),
    discardedBlocks: [...schedule.discardedBlocks, discard],
    updatedAt: discardedAt,
  });
  return {
    schedule: updated,
    discard: { id: randomUUID(), occurredAt: discardedAt, ...discard },
  };
}
