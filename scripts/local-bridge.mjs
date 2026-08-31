import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { buildDailySchedule, resolveNowFocus } from "../src/schedule/scheduler.js";
import { toScheduleTitle } from "../src/schedule/model.js";
import { parseScheduleInboxMarkdown } from "../src/schedule/inbox.js";
import { buildRoutineCandidates } from "../src/schedule/routine-planner.js";
import {
  loadSchedule,
  loadScheduleSettings,
  discardScheduleBlock,
  moveScheduleBlock,
  reportScheduleBlock,
  saveSchedule,
  saveScheduleSettings,
} from "./schedule-store.mjs";
import { calendarEventsToBusyBlocks, inspectGoogleCalendarConnection, readGoogleCalendarBusyBlocks } from "./calendar/google-calendar-reader.mjs";
import { createGoogleCalendarAdapter } from "./calendar/googleapis-adapter.mjs";
import { beginGoogleCalendarAuthorization, finishGoogleCalendarAuthorization, unprotectTokenWithDpapi } from "./calendar/google-oauth.mjs";
import { readActivityLog, recordActivity } from "./activity-log.mjs";

const PORT = Number(process.env.DAYBRIDGE_BRIDGE_PORT || 39393);
const APP_DATA = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
const DATA_DIR = resolve(process.env.DAYBRIDGE_DATA_DIR || join(APP_DATA, "Daybridge"));
const CONFIG_PATH = join(DATA_DIR, "config.json");
const VALID_STATUSES = new Set(["ready", "in_progress", "deferred", "completed", "blocked", "not_started", "paused", "needs_confirmation"]);
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phonePattern = /(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g;
const secretPattern = /(\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret|cookie|session[_ -]?token|private[_ -]?key)\b\s*[:=]\s*)(['"]?)[^\s'"]{8,}/gi;
const localPathPattern = /\b[A-Z]:\\[^\s|]+/gi;
const calendarAuthorizationStates = new Map();
const CODEX_CALENDAR_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

function now() { return new Date().toISOString(); }
function safeDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : null; }
function sanitizeText(value, limit = 600) {
  const text = String(value || "").replace(emailPattern, "[email removed]").replace(phonePattern, "[phone removed]").replace(secretPattern, "$1[sensitive value removed]").replace(localPathPattern, "[local path]").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
}
function boardPath(activityDate) { return join(DATA_DIR, "boards", activityDate + ".json"); }
function inboxPath(activityDate) { return join(DATA_DIR, "inbox", `schedule-${activityDate}.md`); }
function codexCalendarCachePath(activityDate) { return join(DATA_DIR, "calendar-codex-busy", activityDate + ".json"); }
const RUNTIME_LOG_PATH = join(DATA_DIR, "logs", "bridge-events.ndjson");
let runtimeLogQueue = Promise.resolve();
const LOG_DETAIL_KEYS = new Set(["date", "activityDate", "surface", "status", "state", "error", "message", "reason", "connection", "sourceKind", "event", "clientOccurredAt", "announce", "quiet", "rebuild", "mode", "window", "debug", "timeConfigured", "blocks", "focusBlocks", "nowFocus", "questCount", "accepted", "excluded", "valid", "exists", "inboxChanged", "boardExists", "inboxExists", "blockId", "targetBlockId", "position", "durationMinutes", "title", "dayStart", "dayEnd"]);
function logDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const result = {};
  for (const [key, value] of Object.entries(details)) {
    if (!LOG_DETAIL_KEYS.has(key)) continue;
    if (typeof value === "string") result[key] = sanitizeText(value, 500);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) result[key] = value;
  }
  return result;
}
function logRuntimeEvent(event, details = {}) {
  const record = {
    schemaVersion: 1,
    source: "bridge",
    event: sanitizeText(event, 80).replace(/[^a-zA-Z0-9_.:-]/g, "_") || "unknown",
    occurredAt: now(),
    details: logDetails(details),
  };
  runtimeLogQueue = runtimeLogQueue
    .then(async () => {
      await mkdir(dirname(RUNTIME_LOG_PATH), { recursive: true });
      await appendFile(RUNTIME_LOG_PATH, JSON.stringify(record) + "\n", "utf8");
    })
    .catch(() => {});
}
async function readJson(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; } }
function emptyBoard(activityDate, source = "session_inbox") {
  return {
    schemaVersion: 2,
    activityDate,
    sourceCoverage: "connected",
    source: { kind: source },
    sourceWarnings: [],
    quests: [],
    missions: [],
  };
}
function inboxTaskToQuest(task) {
  const id = typeof task?.id === "string" ? task.id : "";
  if (!id) return null;
  const firstStep = task.firstStep || task.currentAction || task.title;
  return {
    id,
    missionId: `mission-${id}`,
    title: task.title,
    scheduleTitle: task.scheduleTitle || task.title,
    displayTitle: task.displayTitle || task.title,
    project: "현재 세션 일정",
    priority: task.priority || "should",
    kind: "execute",
    execution: task.execution || "independent",
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
    state: task.state || "ready",
    status: task.status || task.state || "ready",
    firstStep,
    currentAction: firstStep,
    doneWhen: task.doneWhen || null,
    focusUnits: task.focusUnits,
    remainingUnits: task.remainingUnits,
    estimateMinutes: task.estimateMinutes,
    remainingMinutes: task.remainingMinutes,
    sourceKind: "session",
    sourceLabel: "현재 Codex 세션",
    sourcePath: Array.isArray(task.sourceRefs) && task.sourceRefs[0] ? task.sourceRefs[0] : "daybridge://session-inbox",
    sourceRefs: Array.isArray(task.sourceRefs) ? task.sourceRefs : [],
    carryoverCount: 0,
    reports: [],
    steps: [{ id: `${id}-step-1`, label: firstStep, completed: false, order: 1, dependsOn: [] }],
    progress: { completed: 0, total: 1 },
  };
}
async function readScheduleInbox(activityDate) {
  const path = inboxPath(activityDate);
  try {
    const markdown = await readFile(path, "utf8");
    const parsed = parseScheduleInboxMarkdown(markdown, { date: activityDate });
    const fingerprint = createHash("sha256").update(markdown, "utf8").digest("hex");
    return { ...parsed, fingerprint, exists: true };
  } catch (error) {
    if (error?.code === "ENOENT") return { valid: true, date: activityDate, timezone: "Asia/Seoul", updatedAt: null, tasks: [], excluded: [], warnings: [], errors: [], fingerprint: null, exists: false };
    return { valid: false, date: activityDate, timezone: null, updatedAt: null, tasks: [], excluded: [], warnings: [], errors: ["inbox 파일을 읽지 못했습니다."], fingerprint: null, exists: true };
  }
}
function mergeInboxIntoBoard(board, inbox) {
  if (!inbox?.valid || !inbox.exists) return board;
  const quests = new Map((Array.isArray(board?.quests) ? board.quests : []).map((quest) => [quest.id, quest]));
  const runtimeFields = ["state", "status", "reports", "steps", "progress", "currentAction", "carryoverCount", "remainingUnits", "remainingMinutes", "updatedAt"];
  for (const task of inbox.tasks) {
    const quest = inboxTaskToQuest(task);
    if (!quest) continue;
    const existing = quests.get(quest.id);
    // The Markdown inbox is an input stream, not the mutable state store.
    // Keep Daybridge acknowledgements when the same task is read again.
    quests.set(quest.id, existing ? {
      ...quest,
      ...Object.fromEntries(runtimeFields.filter((field) => Object.hasOwn(existing, field)).map((field) => [field, existing[field]])),
    } : quest);
  }
  return { ...(board || emptyBoard(inbox.date)), quests: [...quests.values()] };
}
async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporary, path);
}
async function loadConfig() {
  const configured = await readJson(CONFIG_PATH);
  const profile = await readJson(join(APP_DATA, "AIHUB", "environment.json"));
  const discoveredSink = profile && typeof profile.aihub_root === "string" && profile.aihub_root.trim()
    ? join(profile.aihub_root, "04_Operations_And_Automation", "Memory_System", "reports", "daily", "_system", "daybridge_handoff")
    : null;
  return { schemaVersion: 1, handoffSinkDir: discoveredSink, ...(configured && typeof configured === "object" ? configured : {}) };
}
function normalizeSteps(value, existing) {
  if (!Array.isArray(value)) return existing;
  const known = new Map(existing.map((step) => [step.id, step]));
  return value.filter((step) => step && typeof step.id === "string" && known.has(step.id)).map((step) => ({ id: step.id, label: sanitizeText(known.get(step.id).label, 180), completed: Boolean(step.completed), order: known.get(step.id).order, dependsOn: known.get(step.id).dependsOn || known.get(step.id).depends_on || [] }));
}
function responseBody(board, connection, eventRecorded = false) { return { board, connection, eventRecorded }; }
async function readRequestBody(request) {
  const chunks = []; let total = 0;
  for await (const chunk of request) { total += chunk.length; if (total > 128 * 1024) throw new Error("Request body is too large."); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("Request body must be valid JSON."); }
}
const allowedOrigins = new Set(["http://127.0.0.1:4173", "http://localhost:4173", "http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:5174", "http://localhost:5174", "http://127.0.0.1:5178", "http://localhost:5178", "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]);
function allowedOrigin(origin) { return allowedOrigins.has(origin) || /^https?:\/\/tauri\.localhost(?::\d+)?$/.test(origin || ""); }
function send(response, status, payload, origin) {
  response.writeHead(status, { "Access-Control-Allow-Origin": allowedOrigin(origin) ? origin : "http://127.0.0.1:4173", "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}
function sendHtml(response, status, markup) {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  response.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Daybridge Calendar</title><style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#15161a;color:#f5f5f6;font:15px/1.6 system-ui,sans-serif}.card{width:min(360px,calc(100% - 40px));padding:28px;border:1px solid #30323a;border-radius:14px;background:#1e2026;box-shadow:0 18px 60px #0005}strong{display:block;font-size:20px;margin-bottom:8px}p{margin:0;color:#b7bac4}</style><main class="card">${markup}</main></html>`);
}
async function writeEvent(config, event) {
  await atomicWrite(join(DATA_DIR, "events", event.activityDate, event.id + ".json"), event);
  if (typeof config.handoffSinkDir !== "string" || !config.handoffSinkDir.trim()) return false;
  await atomicWrite(join(resolve(config.handoffSinkDir), event.activityDate, event.id + ".json"), event);
  return true;
}
function activitySubject({ type = "task", id, questId, title }) {
  return { type, id: sanitizeText(id, 120), questId: sanitizeText(questId, 120), title: sanitizeText(title, 180) };
}
async function handleReport(body) {
  const activityDate = safeDate(body.activityDate); const questId = typeof body.questId === "string" ? body.questId : ""; const status = typeof body.status === "string" ? body.status : "";
  if (!activityDate || !questId || !VALID_STATUSES.has(status)) return { status: 400, body: { error: "activityDate, questId, and status are required." } };
  const path = boardPath(activityDate); const inbox = await readScheduleInbox(activityDate); const board = mergeInboxIntoBoard(await readJson(path), inbox);
  if (!board || !Array.isArray(board.quests)) return { status: 404, body: { error: "No quest board exists for this date." } };
  const quest = board.quests.find((item) => item && item.id === questId);
  if (!quest) return { status: 404, body: { error: "Quest was not found." } };
  quest.status = status; quest.state = status === "not_started" ? "ready" : status === "paused" ? "deferred" : status; quest.steps = normalizeSteps(body.steps, Array.isArray(quest.steps) ? quest.steps : []); quest.progress = { completed: quest.steps.filter((step) => step.completed).length, total: quest.steps.length }; quest.currentAction = sanitizeText(body.nextAction, 240); quest.updatedAt = now();
  const report = { id: randomUUID(), occurredAt: quest.updatedAt, status, note: sanitizeText(body.note), nextAction: sanitizeText(body.nextAction, 240), source: "daybridge" };
  quest.reports = [...(Array.isArray(quest.reports) ? quest.reports : []), report].slice(-20); board.generatedAt = now(); board.sourceCoverage = Array.isArray(board.sourceWarnings) && board.sourceWarnings.length ? "attention" : "connected";
  const config = await loadConfig(); await atomicWrite(path, board); await atomicWrite(join(DATA_DIR, "boards", "latest.json"), board);
  const event = { schemaVersion: 1, id: report.id, eventType: "quest_status_report", activityDate, occurredAt: report.occurredAt, source: "daybridge", sensitivity: "sanitized", quest: { id: quest.id, missionId: quest.missionId || null, title: sanitizeText(quest.title, 180), project: sanitizeText(quest.project, 100), status: quest.status, state: quest.state, progress: quest.progress, carryoverCount: quest.carryoverCount || 0, firstStep: sanitizeText(quest.firstStep, 240), doneWhen: sanitizeText(quest.doneWhen, 240), sourceLabel: sanitizeText(quest.sourceLabel, 100), sourcePath: sanitizeText(quest.sourcePath, 220) }, report };
  const mirrored = await writeEvent(config, event);
  await recordActivity(DATA_DIR, { activityDate, occurredAt: report.occurredAt, action: "status_changed", subject: activitySubject({ id: quest.id, questId: quest.id, title: quest.title }), details: { status: quest.status } });
  return { status: 200, body: responseBody(board, mirrored ? "connected" : "local", mirrored) };
}
const MANUAL_DURATIONS = new Set([50, 100, 150]);
function manualDuration(value) {
  const duration = Number(value);
  return Number.isInteger(duration) && MANUAL_DURATIONS.has(duration) ? duration : null;
}
async function handleManualQuest(body) {
  const activityDate = safeDate(body.activityDate || body.date);
  const title = sanitizeText(body.title, 180);
  const durationMinutes = manualDuration(body.durationMinutes);
  if (!activityDate || !title || !durationMinutes) {
    return { status: 400, body: { error: "activityDate, title, and a 50/100/150-minute duration are required." } };
  }
  const path = boardPath(activityDate);
  const inbox = await readScheduleInbox(activityDate);
  const board = mergeInboxIntoBoard(await readJson(path), inbox) || emptyBoard(activityDate, "manual");
  const occurredAt = now();
  const questId = `manual-${randomUUID()}`;
  const stepId = `${questId}-step-1`;
  const quest = {
    id: questId,
    missionId: `mission-${questId}`,
    title,
    scheduleTitle: title,
    displayTitle: title,
    project: "수동 작업",
    priority: "must",
    kind: "execute",
    execution: "independent",
    dependsOn: [],
    state: "ready",
    status: "ready",
    summary: `${durationMinutes}분 작업을 50분 집중 단위로 나눠 배치합니다.`,
    firstStep: title,
    currentAction: title,
    doneWhen: `${title}을 완료하고 결과를 기록합니다.`,
    estimateMinutes: durationMinutes,
    remainingMinutes: durationMinutes,
    sourceKind: "session",
    sourceLabel: "수동 추가",
    sourcePath: "manual://widget",
    carryoverCount: 0,
    reports: [],
    steps: [{ id: stepId, label: title, completed: false, order: 1, dependsOn: [] }],
    progress: { completed: 0, total: 1 },
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  board.quests = [...board.quests, quest];
  board.generatedAt = occurredAt;
  board.sourceCoverage = Array.isArray(board.sourceWarnings) && board.sourceWarnings.length ? "attention" : "connected";
  const config = await loadConfig();
  await atomicWrite(path, board);
  await atomicWrite(join(DATA_DIR, "boards", "latest.json"), board);
  const event = {
    schemaVersion: 1,
    id: randomUUID(),
    eventType: "manual_quest_created",
    activityDate,
    occurredAt,
    source: "daybridge",
    sensitivity: "sanitized",
    quest: { id: quest.id, title: quest.title, project: quest.project, status: quest.status, estimateMinutes: quest.estimateMinutes, sourceLabel: quest.sourceLabel, sourcePath: quest.sourcePath },
  };
  const mirrored = await writeEvent(config, event);
  await recordActivity(DATA_DIR, { activityDate, occurredAt, action: "task_added", subject: activitySubject({ id: quest.id, questId: quest.id, title: quest.title }), details: { durationMinutes } });
  const schedule = await rebuildSchedule(activityDate);
  if (!schedule) return { status: 500, body: { error: "The task was saved but its schedule could not be rebuilt." } };
  return { status: 201, body: { ...responseBody(board, mirrored ? "connected" : "local", mirrored), quest, schedule, nowFocus: nowFocus(schedule) } };
}
async function handleBoard(url) {
  const requestedDate = safeDate(url.searchParams.get("date")) || new Date().toISOString().slice(0, 10);
  const inbox = await readScheduleInbox(requestedDate);
  const board = mergeInboxIntoBoard(await readJson(boardPath(requestedDate)), inbox);
  logRuntimeEvent("board_read", { date: requestedDate, boardExists: Boolean(board), inboxExists: inbox.exists, valid: inbox.valid, accepted: inbox.tasks.length, excluded: inbox.excluded.length });
  if (!board) return { status: 404, body: { error: "No quest board exists for this date." } };
  const config = await loadConfig(); const connected = typeof config.handoffSinkDir === "string" && config.handoffSinkDir.trim().length > 0;
  return { status: 200, body: responseBody(board, connected ? "connected" : "local") };
}

async function handleRuntimeEvent(body) {
  const event = typeof body?.event === "string" ? body.event : "";
  if (!event) return { status: 400, body: { error: "event is required." } };
  logRuntimeEvent(`client:${event}`, {
    ...(body?.details && typeof body.details === "object" && !Array.isArray(body.details) ? body.details : {}),
    event,
    clientOccurredAt: body?.occurredAt,
    surface: body?.surface,
  });
  return { status: 202, body: { accepted: true } };
}
function toTaskCandidate(quest) {
  if (!quest || typeof quest !== "object" || typeof quest.id !== "string") return null;
  const state = typeof quest.state === "string" ? quest.state : typeof quest.status === "string" ? quest.status : "ready";
  const sourceTitle = sanitizeText(quest.scheduleTitle || quest.displayTitle || quest.title, 180);
  const focusUnits = Number(quest.focusUnits ?? quest.focus_units);
  const legacyEstimate = Number(quest.estimateMinutes);
  const estimateMinutes = Number.isInteger(focusUnits) && focusUnits > 0 ? focusUnits * 50 : (Number.isFinite(legacyEstimate) && legacyEstimate > 0 ? legacyEstimate : 25);
  const remainingUnits = Number(quest.remainingUnits ?? quest.remaining_units);
  const legacyRemaining = Number(quest.remainingMinutes);
  const remainingMinutes = Number.isInteger(remainingUnits) && remainingUnits > 0
    ? Math.min(remainingUnits * 50, estimateMinutes)
    : Math.max(5, Math.min(180, Number.isFinite(legacyRemaining) && legacyRemaining > 0 ? legacyRemaining : estimateMinutes));
  return {
    id: quest.id,
    questId: quest.id,
    missionId: typeof quest.missionId === "string" ? quest.missionId : null,
    scheduleTitle: toScheduleTitle(sourceTitle),
    title: sanitizeText(quest.title, 180),
    project: sanitizeText(quest.project, 100),
    priority: ["must", "should", "could"].includes(quest.priority) ? quest.priority : "should",
    state,
    status: state,
    execution: quest.execution === "sequential" ? "sequential" : "independent",
    dependsOn: Array.isArray(quest.dependsOn) ? quest.dependsOn.filter((id) => typeof id === "string") : [],
    focusUnits: Number.isInteger(focusUnits) && focusUnits > 0 ? focusUnits : Math.max(1, Math.ceil(estimateMinutes / 50)),
    remainingUnits: Number.isInteger(remainingUnits) && remainingUnits > 0 ? Math.max(1, Math.ceil(remainingMinutes / 50)) : Math.max(1, Math.ceil(remainingMinutes / 50)),
    estimateMinutes: Math.max(5, Math.min(180, estimateMinutes)),
    durationMinutes: Math.max(5, Math.min(180, estimateMinutes)),
    remainingMinutes,
    currentAction: sanitizeText(quest.currentAction || quest.firstStep || quest.title, 240),
    steps: Array.isArray(quest.steps) ? quest.steps.map((step) => ({ id: sanitizeText(step?.id, 120), label: sanitizeText(step?.label, 180), completed: Boolean(step?.completed), dependsOn: Array.isArray(step?.dependsOn) ? step.dependsOn.filter((id) => typeof id === "string") : [] })).filter((step) => step.id && step.label) : [],
    sourceKind: quest.sourceKind === "routine" ? "routine" : quest.sourceKind === "session" ? "session" : "briefing",
    sourceRefs: Array.isArray(quest.sourceRefs) ? quest.sourceRefs.map((ref) => sanitizeText(ref, 240)).filter(Boolean) : [],
  };
}
function scheduleDate(value) { return safeDate(value?.date || value?.activityDate) || new Date().toISOString().slice(0, 10); }
function koreaNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const field = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${field.year}-${field.month}-${field.day}T${field.hour}:${field.minute}:${field.second}+09:00`;
}
function nowFocus(schedule) { return resolveNowFocus(schedule, koreaNow()); }
const TERMINAL_BLOCK_STATUSES = new Set(["completed", "deferred", "skipped"]);

function preserveTodoOrder(existingSchedule, generatedSchedule, questIds) {
  if (!existingSchedule || !Array.isArray(existingSchedule.blocks) || !generatedSchedule || !Array.isArray(generatedSchedule.blocks)) return generatedSchedule;
  const generatedByQuest = new Map(generatedSchedule.blocks.filter((block) => block?.type === "focus" && questIds.has(block?.questId)).map((block) => [block.questId, block]));
  const used = new Set();
  const orderedExisting = [...existingSchedule.blocks]
    .filter((block) => block?.type === "focus" && questIds.has(block?.questId))
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const blocks = [];
  for (const existing of orderedExisting) {
    const generated = generatedByQuest.get(existing.questId);
    if (generated) {
      blocks.push({ ...generated, userPositioned: Boolean(existing.userPositioned), locked: Boolean(existing.locked), updatedAt: existing.updatedAt || generated.updatedAt });
      used.add(generated.id);
    } else if (TERMINAL_BLOCK_STATUSES.has(existing.status)) {
      blocks.push(existing);
    }
  }
  for (const block of generatedSchedule.blocks) if (!used.has(block.id) && !blocks.some((item) => item.id === block.id)) blocks.push(block);
  if (!blocks.length) return generatedSchedule;
  const normalizedBlocks = blocks.map((block, index) => ({ ...block, order: index }));
  return { ...generatedSchedule, blocks: normalizedBlocks };
}

function retainedScheduleBlocks(schedule, at) {
  if (!schedule || !Array.isArray(schedule.blocks)) return [];
  const nowAt = Date.parse(at);
  return schedule.blocks
    .filter((block) => !block?.hidden && (TERMINAL_BLOCK_STATUSES.has(block?.status) || block?.locked || (typeof block?.endAt === "string" && Date.parse(block.endAt) <= nowAt)))
    .map((block) => block?.type === "focus" ? { ...block, title: toScheduleTitle(block.title || block.displayTitle || block.scheduleTitle) } : block);
}
function applyDiscardedUnits(tasks, schedule) {
  const discardedUnits = new Map();
  for (const item of schedule?.discardedBlocks || []) {
    if (!item?.questId) continue;
    discardedUnits.set(item.questId, (discardedUnits.get(item.questId) || 0) + (Number.isInteger(item.units) ? item.units : 1));
  }
  return tasks.map((task) => {
    const units = discardedUnits.get(task.id) || 0;
    return units ? { ...task, remainingMinutes: Math.max(0, task.remainingMinutes - (units * 50)) } : task;
  }).filter((task) => task.remainingMinutes > 0);
}
async function syncQuestFromScheduleBlockReport(activityDate, schedule, reportResult) {
  const questId = typeof reportResult?.block?.taskId === "string" ? reportResult.block.taskId : "";
  if (!questId || !schedule || !Array.isArray(schedule.blocks)) return null;
  const path = boardPath(activityDate);
  const inbox = await readScheduleInbox(activityDate);
  const board = mergeInboxIntoBoard(await readJson(path), inbox);
  const quest = board?.quests?.find((item) => item?.id === questId);
  if (!quest) return null;
  const focusBlocks = schedule.blocks.filter((block) => block?.type === "focus" && (block.questId === questId || block.taskId === questId));
  const openBlocks = focusBlocks.filter((block) => !TERMINAL_BLOCK_STATUSES.has(block?.status));
  const completedBlocks = focusBlocks.filter((block) => block?.status === "completed");
  const unscheduledMinutes = (schedule.unscheduled || [])
    .filter((item) => item?.questId === questId)
    .reduce((total, item) => total + (Number.isFinite(Number(item.remainingMinutes)) ? Number(item.remainingMinutes) : 0), 0);
  const hasRemainingWork = openBlocks.length > 0 || unscheduledMinutes > 0;
  const status = reportResult.status;
  const nextState = status === "completed" && focusBlocks.length > 0 && !hasRemainingWork && focusBlocks.every((block) => ["completed", "skipped"].includes(block?.status))
    ? "completed"
    : status === "deferred" ? "deferred"
      : status === "in_progress" || completedBlocks.length > 0 ? "in_progress"
        : status === "planned" ? "ready" : (quest.state || quest.status || "ready");
  const occurredAt = reportResult.occurredAt || now();
  const remainingMinutes = nextState === "completed"
    ? 0
    : Math.max(5, openBlocks.length * 50 + unscheduledMinutes || Number(quest.remainingMinutes) || Number(quest.estimateMinutes) || 50);
  quest.state = nextState;
  quest.status = nextState;
  quest.remainingMinutes = remainingMinutes;
  quest.remainingUnits = nextState === "completed" ? 0 : Math.max(1, Math.ceil(remainingMinutes / 50));
  quest.updatedAt = occurredAt;
  quest.reports = [...(Array.isArray(quest.reports) ? quest.reports : []), {
    id: reportResult.id,
    occurredAt,
    status,
    note: reportResult.note || "",
    source: "daybridge",
  }].slice(-20);
  board.generatedAt = occurredAt;
  board.sourceCoverage = Array.isArray(board.sourceWarnings) && board.sourceWarnings.length ? "attention" : "connected";
  await atomicWrite(path, board);
  await atomicWrite(join(DATA_DIR, "boards", "latest.json"), board);
  return board;
}
async function rebuildSchedule(activityDate) {
  const inbox = await readScheduleInbox(activityDate);
  let board = await readJson(boardPath(activityDate));
  if (!board || !Array.isArray(board.quests)) {
    if (!inbox.valid || !inbox.exists) return null;
    board = emptyBoard(activityDate);
  }
  const settings = await loadScheduleSettings(DATA_DIR);
  const existingSchedule = await loadSchedule(DATA_DIR, activityDate);
  const generatedAt = koreaNow();
  const briefingTasks = board.quests.map(toTaskCandidate).filter(Boolean);
  // A malformed handoff must never erase a previously usable timetable.
  if (!inbox.valid && existingSchedule) return existingSchedule;
  const inboxTasks = inbox.valid ? inbox.tasks.map(toTaskCandidate).filter(Boolean) : [];
  const routineTasks = buildRoutineCandidates({ date: activityDate, board });
  const taskMap = new Map();
  for (const task of [...briefingTasks, ...inboxTasks, ...routineTasks]) taskMap.set(task.id, task);
  const tasks = applyDiscardedUnits([...taskMap.values()], existingSchedule);
  const completedQuestIds = board.quests.filter((quest) => (quest?.state || quest?.status) === "completed").map((quest) => quest.id).filter((id) => typeof id === "string");
  const calendarResult = await readCalendarBusyBlocks(activityDate);
  const coverage = calendarResult.calendar.state === "connected" ? "connected" : "attention";
  const generated = buildDailySchedule({ date: activityDate, settings, taskCandidates: tasks, busyBlocks: calendarResult.busyBlocks, lockedBlocks: retainedScheduleBlocks(existingSchedule, generatedAt), completedQuestIds, startAt: generatedAt, generatedAt });
  const boardQuestIds = new Set(board.quests.map((quest) => quest?.id).filter((id) => typeof id === "string"));
  const scheduleWithTerminals = settings.timeConfigured ? generated : preserveTodoOrder(existingSchedule, generated, boardQuestIds);
  return saveSchedule(DATA_DIR, activityDate, {
    ...scheduleWithTerminals,
    date: activityDate,
    timezone: "Asia/Seoul",
    calendar: { coverage },
    busyBlocks: [],
    discardedBlocks: existingSchedule?.discardedBlocks || [],
    inbox: {
      exists: inbox.exists,
      valid: inbox.valid,
      fingerprint: inbox.fingerprint,
      accepted: inbox.tasks.length,
      excluded: inbox.excluded.length,
      errors: inbox.errors.slice(0, 10),
    },
  });
}
async function handleSchedule(url) {
  const activityDate = safeDate(url.searchParams.get("date")) || new Date().toISOString().slice(0, 10);
  const existing = await loadSchedule(DATA_DIR, activityDate);
  const inbox = await readScheduleInbox(activityDate);
  const inboxChanged = existing && inbox.valid && existing.inbox?.fingerprint !== inbox.fingerprint;
  const settings = await loadScheduleSettings(DATA_DIR);
  const existingMode = existing?.mode === "todo" || existing?.timeConfigured === false ? "todo" : "timed";
  const requestedMode = settings.timeConfigured ? "timed" : "todo";
  const settingsChanged = Boolean(existing && existingMode !== requestedMode);
  const schedule = (!existing || inboxChanged || settingsChanged) ? await rebuildSchedule(activityDate) : existing;
  logRuntimeEvent("schedule_read", { date: activityDate, exists: Boolean(schedule), inboxExists: inbox.exists, valid: inbox.valid, accepted: inbox.tasks.length, excluded: inbox.excluded.length, inboxChanged, settingsChanged, mode: schedule?.mode || "timed", timeConfigured: schedule?.timeConfigured !== false, blocks: Array.isArray(schedule?.blocks) ? schedule.blocks.length : 0, focusBlocks: Array.isArray(schedule?.blocks) ? schedule.blocks.filter((block) => block?.type === "focus").length : 0 });
  if (!schedule) return { status: 404, body: { error: "No quest board exists for this date." } };
  return { status: 200, body: { schedule, nowFocus: nowFocus(schedule) } };
}
async function handleScheduleInbox(url) {
  const activityDate = safeDate(url.searchParams.get("date")) || new Date().toISOString().slice(0, 10);
  const inbox = await readScheduleInbox(activityDate);
  return { status: 200, body: {
    date: activityDate,
    exists: inbox.exists,
    valid: inbox.valid,
    fingerprint: inbox.fingerprint,
    updatedAt: inbox.updatedAt,
    tasks: inbox.tasks,
    excluded: inbox.excluded,
    warnings: inbox.warnings,
    errors: inbox.errors,
  } };
}
async function handleScheduleRebuild(body) {
  const activityDate = safeDate(body?.activityDate || body?.date) || koreaNow().slice(0, 10);
  const schedule = await rebuildSchedule(activityDate);
  if (!schedule) return { status: 404, body: { error: "No quest board exists for this date." } };
  await recordActivity(DATA_DIR, { activityDate, action: "schedule_rebuilt", subject: activitySubject({ type: "schedule", id: activityDate, title: "오늘 일정" }), details: { mode: schedule.mode, timeConfigured: schedule.timeConfigured !== false } });
  return { status: 200, body: { schedule, nowFocus: nowFocus(schedule) } };
}
async function handleScheduleSettingsUpdate(body) {
  const current = await loadScheduleSettings(DATA_DIR);
  const settings = await saveScheduleSettings(DATA_DIR, { ...current, ...body });
  const activityDate = safeDate(body?.activityDate || body?.date) || koreaNow().slice(0, 10);
  await recordActivity(DATA_DIR, {
    activityDate,
    action: "schedule_settings_changed",
    subject: activitySubject({ type: "schedule", id: "settings", title: "시간표 설정" }),
    details: { timeConfigured: settings.timeConfigured, dayStart: settings.dayStart, dayEnd: settings.dayEnd, bufferMinutes: settings.bufferMinutes },
  });
  return { status: 200, body: { settings } };
}
async function handleScheduleBlockReport(body) {
  const activityDate = safeDate(body.activityDate || body.date);
  if (!activityDate) return { status: 400, body: { error: "activityDate and a valid block report are required." } };
  let result;
  try { result = await reportScheduleBlock(DATA_DIR, activityDate, body); } catch (error) { return { status: 400, body: { error: error instanceof Error ? sanitizeText(error.message, 160) : "Invalid block report." } }; }
  if (!result) return { status: 404, body: { error: "No schedule exists for this date." } };
  if (!result.schedule) return { status: 404, body: { error: "Schedule block was not found." } };
  await syncQuestFromScheduleBlockReport(activityDate, result.schedule, result.report);
  const config = await loadConfig();
  const event = { schemaVersion: 1, id: result.report.id, eventType: "schedule_block_report", activityDate, occurredAt: result.report.occurredAt, source: "daybridge", sensitivity: "sanitized", block: result.report.block, report: { id: result.report.id, occurredAt: result.report.occurredAt, status: result.report.status, note: result.report.note, source: "daybridge" } };
  const mirrored = await writeEvent(config, event);
  await recordActivity(DATA_DIR, { activityDate, occurredAt: result.report.occurredAt, action: "status_changed", subject: activitySubject({ type: "schedule_block", id: result.report.block.id, questId: result.report.block.taskId, title: result.report.block.title }), details: { status: result.report.status } });
  return { status: 200, body: { schedule: result.schedule, nowFocus: nowFocus(result.schedule), connection: mirrored ? "connected" : "local", eventRecorded: mirrored } };
}
async function handleScheduleBlockMove(body) {
  const activityDate = safeDate(body.activityDate || body.date);
  if (!activityDate) return { status: 400, body: { error: "activityDate and a valid block move are required." } };
  let result;
  try { result = await moveScheduleBlock(DATA_DIR, activityDate, body); } catch (error) { return { status: 400, body: { error: error instanceof Error ? sanitizeText(error.message, 180) : "Invalid block move." } }; }
  if (!result) return { status: 404, body: { error: "No schedule exists for this date." } };
  if (!result.schedule) return { status: 404, body: { error: "Schedule block was not found." } };
  const config = await loadConfig();
  const event = {
    schemaVersion: 1,
    id: result.movement.id,
    eventType: "schedule_block_moved",
    activityDate,
    occurredAt: result.movement.occurredAt,
    source: "daybridge",
    sensitivity: "sanitized",
    movement: {
      sourceBlockId: result.movement.sourceBlockId,
      targetBlockId: result.movement.targetBlockId,
      position: result.movement.position,
      block: result.movement.block,
    },
  };
  const mirrored = await writeEvent(config, event);
  const target = result.movement.targetBlockId ? result.schedule.blocks.find((block) => block?.id === result.movement.targetBlockId) : null;
  await recordActivity(DATA_DIR, { activityDate, occurredAt: result.movement.occurredAt, action: "task_reordered", subject: activitySubject({ type: "schedule_block", id: result.movement.block.id, questId: result.movement.block.questId, title: result.movement.block.title }), details: { position: result.movement.position, targetBlockId: result.movement.targetBlockId, targetTitle: target?.title, startAt: result.movement.block.startAt, endAt: result.movement.block.endAt } });
  return { status: 200, body: { schedule: result.schedule, nowFocus: nowFocus(result.schedule), connection: mirrored ? "connected" : "local", eventRecorded: mirrored } };
}
async function handleScheduleBlockDiscard(body) {
  const activityDate = safeDate(body.activityDate || body.date);
  if (!activityDate) return { status: 400, body: { error: "activityDate and a valid block discard are required." } };
  let result;
  try { result = await discardScheduleBlock(DATA_DIR, activityDate, body); } catch (error) { return { status: 400, body: { error: error instanceof Error ? sanitizeText(error.message, 180) : "Invalid block discard." } }; }
  if (!result) return { status: 404, body: { error: "No schedule exists for this date." } };
  if (!result.schedule) return { status: 404, body: { error: "Schedule block was not found." } };
  const config = await loadConfig();
  const event = {
    schemaVersion: 1,
    id: result.discard.id,
    eventType: "schedule_block_discarded",
    activityDate,
    occurredAt: result.discard.occurredAt,
    source: "daybridge",
    sensitivity: "sanitized",
    discard: { blockId: result.discard.blockId, questId: result.discard.questId, title: result.discard.title, units: result.discard.units },
  };
  const mirrored = await writeEvent(config, event);
  await recordActivity(DATA_DIR, { activityDate, occurredAt: result.discard.occurredAt, action: "task_removed", subject: activitySubject({ type: "schedule_block", id: result.discard.blockId, questId: result.discard.questId, title: result.discard.title }), details: { reason: "today_schedule" } });
  return { status: 200, body: { schedule: result.schedule, nowFocus: nowFocus(result.schedule), connection: mirrored ? "connected" : "local", eventRecorded: mirrored } };
}
function calendarRedirectUri() { return `http://127.0.0.1:${PORT}/api/calendar/oauth/callback`; }
async function readCodexCalendarCache(activityDate) {
  const cache = await readJson(codexCalendarCachePath(activityDate));
  const fetchedAt = Date.parse(cache?.fetchedAt || "");
  if (!cache || cache.date !== activityDate || !Number.isFinite(fetchedAt) || (Date.now() - fetchedAt) > CODEX_CALENDAR_CACHE_TTL_MS || !Array.isArray(cache.busyBlocks)) return null;
  const busyBlocks = cache.busyBlocks.filter((block) => block?.type === "busy" && typeof block.id === "string" && typeof block.startAt === "string" && typeof block.endAt === "string").map((block) => ({ id: block.id, type: "busy", startAt: block.startAt, endAt: block.endAt, locked: true }));
  return { calendar: { state: "connected", reason: "codex_relay", canReadBusyBlocks: true }, busyBlocks };
}
async function readCalendarBusyBlocks(activityDate) {
  const direct = await readGoogleCalendarBusyBlocks({ date: activityDate, dataDir: DATA_DIR, adapter: createGoogleCalendarAdapter(), unprotectToken: unprotectTokenWithDpapi });
  if (direct.calendar.state === "connected") return direct;
  return (await readCodexCalendarCache(activityDate)) || direct;
}
function removeExpiredCalendarAuthorizations(at = Date.now()) {
  for (const [state, expiresAt] of calendarAuthorizationStates) if (expiresAt <= at) calendarAuthorizationStates.delete(state);
}
async function handleCalendarStatus() {
  const direct = await inspectGoogleCalendarConnection({ dataDir: DATA_DIR });
  if (direct.state === "connected") return { status: 200, body: { calendar: direct } };
  const activityDate = koreaNow().slice(0, 10);
  const cached = await readCodexCalendarCache(activityDate);
  return { status: 200, body: { calendar: cached?.calendar || direct } };
}
async function handleCalendarConnect() {
  const status = await handleCalendarStatus();
  if (status.body.calendar.reason === "codex_relay") return status;
  removeExpiredCalendarAuthorizations();
  const state = randomUUID();
  const result = await beginGoogleCalendarAuthorization({ dataDir: DATA_DIR, redirectUri: calendarRedirectUri(), state });
  if (result.state === "needs_authorization" && result.authorizationUrl) calendarAuthorizationStates.set(state, Date.now() + (10 * 60 * 1000));
  return { status: result.state === "attention" ? 400 : 200, body: { calendar: { state: result.state, reason: result.reason }, authorizationUrl: result.authorizationUrl || null } };
}
async function handleCodexCalendarBusy(body) {
  const activityDate = safeDate(body.date || body.activityDate);
  if (!activityDate || !Array.isArray(body.busy)) return { status: 400, body: { error: "date and busy time ranges are required." } };
  const events = body.busy.slice(0, 250).map((item) => ({ start: { dateTime: item?.start }, end: { dateTime: item?.end } }));
  let busyBlocks;
  try { busyBlocks = calendarEventsToBusyBlocks({ date: activityDate, events }); } catch { return { status: 400, body: { error: "busy ranges must be valid calendar timestamps." } }; }
  await atomicWrite(codexCalendarCachePath(activityDate), { schemaVersion: 1, source: "codex_calendar_connector", date: activityDate, fetchedAt: now(), busyBlocks });
  return { status: 200, body: { calendar: { state: "connected", reason: "codex_relay", canReadBusyBlocks: true }, busyBlockCount: busyBlocks.length } };
}
async function handleCalendarCallback(url, response) {
  removeExpiredCalendarAuthorizations();
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const providerError = url.searchParams.get("error");
  const expiresAt = calendarAuthorizationStates.get(state);
  calendarAuthorizationStates.delete(state);
  if (!expiresAt || expiresAt <= Date.now()) { sendHtml(response, 400, "<strong>연결을 확인할 수 없어요</strong><p>Daybridge에서 다시 연결을 시작한 뒤 이 창을 열어 주세요.</p>"); return; }
  if (providerError || !code) { sendHtml(response, 400, "<strong>캘린더 연결이 취소되었어요</strong><p>승인하지 않은 상태입니다. 필요할 때 Daybridge에서 다시 연결할 수 있어요.</p>"); return; }
  const result = await finishGoogleCalendarAuthorization({ dataDir: DATA_DIR, redirectUri: calendarRedirectUri(), code });
  if (result.state === "connected") { sendHtml(response, 200, "<strong>Google Calendar가 연결되었어요</strong><p>Daybridge는 일정 제목이나 참석자를 읽지 않고, 바쁜 시간만 시간표에 반영합니다. 이 창은 닫아도 됩니다.</p><script>setTimeout(()=>window.close(),1200)</script>"); return; }
  sendHtml(response, 400, "<strong>연결을 완료하지 못했어요</strong><p>OAuth 설정과 권한을 확인한 뒤 Daybridge에서 다시 시도해 주세요.</p>");
}
const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (!request.url) { send(response, 400, { error: "Request URL is required." }, origin); return; }
  if (request.method === "OPTIONS") { send(response, 204, {}, origin); return; }
  const url = new URL(request.url, "http://127.0.0.1:" + PORT);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") { const config = await loadConfig(); send(response, 200, { status: "ok", dataDir: DATA_DIR, handoffSinkDir: config.handoffSinkDir || null, connected: Boolean(config.handoffSinkDir) }, origin); return; }
    if (request.method === "GET" && url.pathname === "/api/calendar/oauth/callback") { await handleCalendarCallback(url, response); return; }
    if (request.method === "GET" && url.pathname === "/api/calendar/status") { const result = await handleCalendarStatus(); send(response, result.status, result.body, origin); return; }
    if (request.method === "POST" && url.pathname === "/api/calendar/connect") { const result = await handleCalendarConnect(); send(response, result.status, result.body, origin); return; }
    if (request.method === "POST" && url.pathname === "/api/calendar/codex-busy") { const result = await handleCodexCalendarBusy(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    if (request.method === "POST" && url.pathname === "/api/runtime-events") { const result = await handleRuntimeEvent(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    if (request.method === "GET" && url.pathname === "/api/board") { const result = await handleBoard(url); send(response, result.status, result.body, origin); return; }
    if (request.method === "POST" && url.pathname === "/api/report") { const result = await handleReport(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    if (request.method === "POST" && url.pathname === "/api/quests/manual") { const result = await handleManualQuest(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    if (request.method === "GET" && url.pathname === "/api/schedule") { const result = await handleSchedule(url); send(response, result.status, result.body, origin); return; }
    if (request.method === "GET" && url.pathname === "/api/schedule/inbox") { const result = await handleScheduleInbox(url); send(response, result.status, result.body, origin); return; }
    if (request.method === "GET" && url.pathname === "/api/activity") { const activityDate = safeDate(url.searchParams.get("date")) || koreaNow().slice(0, 10); const records = await readActivityLog(DATA_DIR, activityDate, { limit: Number(url.searchParams.get("limit")) || 200 }); send(response, 200, { activityDate, records }); return; }
    if (request.method === "POST" && url.pathname === "/api/schedule/rebuild") { const result = await handleScheduleRebuild(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    if (request.method === "GET" && url.pathname === "/api/schedule-settings") { send(response, 200, { settings: await loadScheduleSettings(DATA_DIR) }, origin); return; }
    if (request.method === "PUT" && url.pathname === "/api/schedule-settings") { const result = await handleScheduleSettingsUpdate(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    if (request.method === "POST" && url.pathname === "/api/schedule/block-report") { const result = await handleScheduleBlockReport(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    if (request.method === "POST" && url.pathname === "/api/schedule/block-move") { const result = await handleScheduleBlockMove(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    if (request.method === "POST" && url.pathname === "/api/schedule/block-discard") { const result = await handleScheduleBlockDiscard(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    send(response, 404, { error: "Not found." }, origin);
  } catch (error) { send(response, 500, { error: error instanceof Error ? sanitizeText(error.message, 160) : "Unexpected bridge error." }, origin); }
});
await mkdir(join(DATA_DIR, "boards"), { recursive: true });
logRuntimeEvent("bridge_started", { accepted: true, connection: "local" });
process.on("uncaughtException", (error) => {
  logRuntimeEvent("bridge_uncaught_exception", { error: error?.message || String(error) });
  console.error(error);
  process.exitCode = 1;
});
process.on("unhandledRejection", (reason) => {
  logRuntimeEvent("bridge_unhandled_rejection", { error: reason?.message || String(reason) });
  console.error(reason);
});
server.listen(PORT, "127.0.0.1", () => console.log("Daybridge local bridge listening on http://127.0.0.1:" + PORT));
