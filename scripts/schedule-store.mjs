import { randomUUID } from "node:crypto";
import { readJsonStrict as readJson, atomicWriteJson as atomicWrite, StoreError } from "./storage/json-store.mjs";
import { join, resolve } from "node:path";
import { runStoreOperation } from "./storage/date-transaction.mjs";
import { getAvailableFocusSlots } from "../src/schedule/scheduler.js";
import { DEFAULT_SCHEDULE_SETTINGS, normalizeScheduleSettings } from "../src/schedule/settings-contract.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_STATUSES = new Set(["planned", "in_progress", "completed", "skipped", "deferred"]);
const CALENDAR_COVERAGE = new Set(["connected", "attention", "stale", "unavailable"]);
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phonePattern = /(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g;
const secretPattern = /(\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret|cookie|session[_ -]?token|private[_ -]?key)\b\s*[:=]\s*)(['"]?)[^\s'"]{8,}/gi;
const localPathPattern = /\b[A-Z]:\\[^\s|]+/gi;

export { DEFAULT_SCHEDULE_SETTINGS };

export const DEFAULT_DAILY_DEFAULTS = Object.freeze({
  schemaVersion: 1,
  routines: Object.freeze([
    Object.freeze({ id: "supplement", title: "영양제 먹기", estimateMinutes: 25, days: Object.freeze([0, 1, 2, 3, 4, 5, 6]), enabled: true }),
  ]),
});

function isDate(value) { return DATE.test(value || ""); }
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
function normalizeSettings(input = {}) {
  const candidate = sanitizeValue(input, 600);
  // Preserve the pre-optional-time migration at the storage boundary only.
  const legacyImplicitDefault = !Object.hasOwn(candidate, "timeConfigured") && candidate.dayStart === "09:00" && candidate.dayEnd === "18:00";
  return normalizeScheduleSettings(legacyImplicitDefault ? { ...candidate, timeConfigured: false } : candidate);
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

function orderedFocusBlocks(blocks) {
  return blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block?.type === "focus")
    .sort((left, right) => {
      const leftOrder = Number(left.block?.order);
      const rightOrder = Number(right.block?.order);
      const hasLeftOrder = Number.isFinite(leftOrder);
      const hasRightOrder = Number.isFinite(rightOrder);
      if (hasLeftOrder && hasRightOrder && leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (hasLeftOrder !== hasRightOrder) return hasLeftOrder ? -1 : 1;
      const leftStart = Date.parse(left.block?.startAt || "");
      const rightStart = Date.parse(right.block?.startAt || "");
      const hasLeftStart = Number.isFinite(leftStart);
      const hasRightStart = Number.isFinite(rightStart);
      if (hasLeftStart && hasRightStart && leftStart !== rightStart) return leftStart - rightStart;
      if (hasLeftStart !== hasRightStart) return hasLeftStart ? -1 : 1;
      return left.index - right.index;
    });
}

function nextPlannedFocusBlock(blocks, completedBlockId) {
  const focusBlocks = orderedFocusBlocks(blocks);
  const completedIndex = focusBlocks.findIndex(({ block }) => block.id === completedBlockId);
  if (completedIndex < 0) return null;
  // Follow the order shown to the user, wrapping only when the remaining
  // actionable card sits above the task just completed.
  const candidates = [...focusBlocks.slice(completedIndex + 1), ...focusBlocks.slice(0, completedIndex)];
  return candidates.find(({ block }) => block.status === "planned") || null;
}

function hasOtherInProgressBlock(blocks, completedBlockId) {
  return blocks.some((block) => block.id !== completedBlockId && block.status === "in_progress");
}
function normalizeDiscardedBlocks(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    blockId: typeof item?.blockId === "string" ? sanitizeText(item.blockId, 120) : "",
    questId: typeof item?.questId === "string" ? sanitizeText(item.questId, 120) : "",
    title: typeof item?.title === "string" ? sanitizeText(item.title, 180) : "",
    units: Number.isInteger(item?.units) && item.units > 0 ? Math.min(item.units, 10) : 1,
    ...(Number.isFinite(item?.workMinutes) && item.workMinutes > 0 ? { workMinutes: item.workMinutes } : {}),
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

async function loadDailyDefaultsUnlocked(dataDir) {
  const stored = await readJson(dailyDefaultsPath(dataDir));
  const normalized = normalizeDailyDefaults(stored);
  if (Array.isArray(stored) || Array.isArray(stored?.routines)) return normalized;
  return { schemaVersion: 1, routines: DEFAULT_DAILY_DEFAULTS.routines.map((routine) => ({ ...routine, days: [...routine.days] })) };
}

async function saveDailyDefaultsUnlocked(dataDir, input) {
  const normalized = normalizeDailyDefaults(input);
  await atomicWrite(dailyDefaultsPath(dataDir), normalized);
  return normalized;
}

async function loadScheduleSettingsUnlocked(dataDir) {
  const stored = await readJson(settingsPath(dataDir));
  try {
    const normalized = normalizeSettings(stored || DEFAULT_SCHEDULE_SETTINGS);
    return normalized;
  } catch (error) { throw new StoreError("invalid_settings", "저장된 시간 설정을 확인해 주세요. 기존 설정 파일은 유지했습니다.", error); }
}

async function saveScheduleSettingsUnlocked(dataDir, settings) {
  const normalized = normalizeSettings(settings || {});
  await atomicWrite(settingsPath(dataDir), normalized);
  return normalized;
}

async function loadScheduleUnlocked(dataDir, date) {
  const requestedDate = assertDate(date);
  const stored = await readJson(schedulePath(dataDir, requestedDate));
  if (!stored) return null;
  if (Array.isArray(stored) || !Array.isArray(stored.blocks)) throw new StoreError("invalid_record", "Stored schedule blocks are invalid; preserve the original file.");
  try { return normalizeSchedule(requestedDate, stored); } catch (error) { throw new StoreError("invalid_record", "Stored schedule is invalid; preserve the original file.", error); }
}

async function saveScheduleUnlocked(dataDir, date, schedule) {
  const requestedDate = assertDate(date);
  const normalized = normalizeSchedule(requestedDate, schedule);
  await atomicWrite(schedulePath(dataDir, requestedDate), normalized);
  return normalized;
}

async function reportScheduleBlockUnlocked(dataDir, date, input = {}) {
  const requestedDate = assertDate(date);
  const blockId = typeof input.blockId === "string" ? sanitizeText(input.blockId, 120) : "";
  const status = typeof input.status === "string" ? input.status : "";
  if (!blockId || !SCHEDULE_STATUSES.has(status)) throw new TypeError("blockId and a valid block status are required.");
  const schedule = await loadSchedule(dataDir, requestedDate);
  if (!schedule) return null;
  const index = schedule.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return { schedule: null, report: null };
  const previous = schedule.blocks[index];
  const occurredAt = typeof input.occurredAt === "string" && !Number.isNaN(Date.parse(input.occurredAt)) ? input.occurredAt : now();
  const report = {
    id: randomUUID(),
    occurredAt,
    status,
    note: sanitizeText(input.note, 600),
    source: "daybridge",
  };
  // The completion may arrive after another card has been started manually.
  // In that case, preserve that explicit focus instead of creating a second
  // in-progress card through automatic promotion.
  const nextFocus = status === "completed" && previous?.status === "in_progress" && !hasOtherInProgressBlock(schedule.blocks, blockId)
    ? nextPlannedFocusBlock(schedule.blocks, blockId)
    : null;
  const autoStarted = nextFocus ? {
    id: randomUUID(),
    occurredAt,
    status: "in_progress",
    note: "이전 진행 작업 완료 후 자동 시작",
    source: "daybridge_auto_start",
  } : null;
  const blocks = schedule.blocks.map((block, blockIndex) => {
    if (blockIndex === index) {
      return { ...block, status, updatedAt: occurredAt, reports: [...(Array.isArray(block.reports) ? block.reports : []), report].slice(-20) };
    }
    if (nextFocus && blockIndex === nextFocus.index) {
      return { ...block, status: "in_progress", updatedAt: occurredAt, reports: [...(Array.isArray(block.reports) ? block.reports : []), autoStarted].slice(-20) };
    }
    return block;
  });
  const updated = await saveSchedule(dataDir, requestedDate, { ...schedule, blocks, updatedAt: occurredAt });
  const block = updated.blocks.find((item) => item.id === blockId);
  const autoStartedBlock = nextFocus ? updated.blocks.find((item) => item.id === nextFocus.block.id) : null;
  return {
    schedule: updated,
    report: { ...report, block: { id: block.id, taskId: sanitizeText(block.taskId || block.questId, 120), title: sanitizeText(block.title, 180), status: block.status } },
    autoStarted: autoStarted && autoStartedBlock ? {
      ...autoStarted,
      block: {
        id: autoStartedBlock.id,
        taskId: sanitizeText(autoStartedBlock.taskId || autoStartedBlock.questId, 120),
        title: sanitizeText(autoStartedBlock.title, 180),
        status: autoStartedBlock.status,
      },
    } : null,
  };
}

async function moveScheduleBlockUnlocked(dataDir, date, input = {}) {
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

async function discardScheduleBlockUnlocked(dataDir, date, input = {}) {
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
    ...(Number.isFinite(source.workMinutes) && source.workMinutes > 0 ? { workMinutes: source.workMinutes } : {}),
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

export async function loadDailyDefaults(dataDir, ...args) {
  return await runStoreOperation(dataDir, "global", () => loadDailyDefaultsUnlocked(dataDir, ...args));
}

export async function saveDailyDefaults(dataDir, ...args) {
  return await runStoreOperation(dataDir, "global", () => saveDailyDefaultsUnlocked(dataDir, ...args));
}

export async function loadScheduleSettings(dataDir, ...args) {
  return await runStoreOperation(dataDir, "global", () => loadScheduleSettingsUnlocked(dataDir, ...args));
}

export async function saveScheduleSettings(dataDir, ...args) {
  return await runStoreOperation(dataDir, "global", () => saveScheduleSettingsUnlocked(dataDir, ...args));
}

export async function loadSchedule(dataDir, ...args) {
  return await runStoreOperation(dataDir, args[0], () => loadScheduleUnlocked(dataDir, ...args));
}

export async function saveSchedule(dataDir, ...args) {
  return await runStoreOperation(dataDir, args[0], () => saveScheduleUnlocked(dataDir, ...args));
}

export async function reportScheduleBlock(dataDir, ...args) {
  return await runStoreOperation(dataDir, args[0], () => reportScheduleBlockUnlocked(dataDir, ...args));
}

export async function moveScheduleBlock(dataDir, ...args) {
  return await runStoreOperation(dataDir, args[0], () => moveScheduleBlockUnlocked(dataDir, ...args));
}

export async function discardScheduleBlock(dataDir, ...args) {
  return await runStoreOperation(dataDir, args[0], () => discardScheduleBlockUnlocked(dataDir, ...args));
}
