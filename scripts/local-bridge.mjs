import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { buildDailySchedule, resolveNowFocus } from "../src/schedule/scheduler.js";
import {
  loadSchedule,
  loadScheduleSettings,
  reportScheduleBlock,
  saveSchedule,
  saveScheduleSettings,
} from "./schedule-store.mjs";

const PORT = Number(process.env.DAYBRIDGE_BRIDGE_PORT || 39393);
const APP_DATA = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
const DATA_DIR = resolve(process.env.DAYBRIDGE_DATA_DIR || join(APP_DATA, "Daybridge"));
const CONFIG_PATH = join(DATA_DIR, "config.json");
const VALID_STATUSES = new Set(["ready", "in_progress", "deferred", "completed", "blocked", "not_started", "paused", "needs_confirmation"]);
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phonePattern = /(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g;
const secretPattern = /(\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret|cookie|session[_ -]?token|private[_ -]?key)\b\s*[:=]\s*)(['"]?)[^\s'"]{8,}/gi;
const localPathPattern = /\b[A-Z]:\\[^\s|]+/gi;

function now() { return new Date().toISOString(); }
function safeDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : null; }
function sanitizeText(value, limit = 600) {
  const text = String(value || "").replace(emailPattern, "[email removed]").replace(phonePattern, "[phone removed]").replace(secretPattern, "$1[sensitive value removed]").replace(localPathPattern, "[local path]").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
}
function boardPath(activityDate) { return join(DATA_DIR, "boards", activityDate + ".json"); }
async function readJson(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; } }
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
const allowedOrigins = new Set(["http://127.0.0.1:4173", "http://localhost:4173", "http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:5174", "http://localhost:5174", "http://127.0.0.1:5178", "http://localhost:5178"]);
function send(response, status, payload, origin) {
  response.writeHead(status, { "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "http://127.0.0.1:4173", "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}
async function writeEvent(config, event) {
  await atomicWrite(join(DATA_DIR, "events", event.activityDate, event.id + ".json"), event);
  if (typeof config.handoffSinkDir !== "string" || !config.handoffSinkDir.trim()) return false;
  await atomicWrite(join(resolve(config.handoffSinkDir), event.activityDate, event.id + ".json"), event);
  return true;
}
async function handleReport(body) {
  const activityDate = safeDate(body.activityDate); const questId = typeof body.questId === "string" ? body.questId : ""; const status = typeof body.status === "string" ? body.status : "";
  if (!activityDate || !questId || !VALID_STATUSES.has(status)) return { status: 400, body: { error: "activityDate, questId, and status are required." } };
  const path = boardPath(activityDate); const board = await readJson(path);
  if (!board || !Array.isArray(board.quests)) return { status: 404, body: { error: "No quest board exists for this date." } };
  const quest = board.quests.find((item) => item && item.id === questId);
  if (!quest) return { status: 404, body: { error: "Quest was not found." } };
  quest.status = status; quest.state = status === "not_started" ? "ready" : status === "paused" ? "deferred" : status; quest.steps = normalizeSteps(body.steps, Array.isArray(quest.steps) ? quest.steps : []); quest.progress = { completed: quest.steps.filter((step) => step.completed).length, total: quest.steps.length }; quest.currentAction = sanitizeText(body.nextAction, 240); quest.updatedAt = now();
  const report = { id: randomUUID(), occurredAt: quest.updatedAt, status, note: sanitizeText(body.note), nextAction: sanitizeText(body.nextAction, 240), source: "daybridge" };
  quest.reports = [...(Array.isArray(quest.reports) ? quest.reports : []), report].slice(-20); board.generatedAt = now(); board.sourceCoverage = Array.isArray(board.sourceWarnings) && board.sourceWarnings.length ? "attention" : "connected";
  const config = await loadConfig(); await atomicWrite(path, board); await atomicWrite(join(DATA_DIR, "boards", "latest.json"), board);
  const event = { schemaVersion: 1, id: report.id, eventType: "quest_status_report", activityDate, occurredAt: report.occurredAt, source: "daybridge", sensitivity: "sanitized", quest: { id: quest.id, missionId: quest.missionId || null, title: sanitizeText(quest.title, 180), project: sanitizeText(quest.project, 100), status: quest.status, state: quest.state, progress: quest.progress, carryoverCount: quest.carryoverCount || 0, firstStep: sanitizeText(quest.firstStep, 240), doneWhen: sanitizeText(quest.doneWhen, 240), sourceLabel: sanitizeText(quest.sourceLabel, 100), sourcePath: sanitizeText(quest.sourcePath, 220) }, report };
  const mirrored = await writeEvent(config, event);
  return { status: 200, body: responseBody(board, mirrored ? "connected" : "local", mirrored) };
}
async function handleBoard(url) {
  const requestedDate = safeDate(url.searchParams.get("date")) || new Date().toISOString().slice(0, 10); const board = await readJson(boardPath(requestedDate));
  if (!board) return { status: 404, body: { error: "No quest board exists for this date." } };
  const config = await loadConfig(); const connected = typeof config.handoffSinkDir === "string" && config.handoffSinkDir.trim().length > 0;
  return { status: 200, body: responseBody(board, connected ? "connected" : "local") };
}
function toTaskCandidate(quest) {
  if (!quest || typeof quest !== "object" || typeof quest.id !== "string") return null;
  const state = typeof quest.state === "string" ? quest.state : typeof quest.status === "string" ? quest.status : "ready";
  return {
    id: quest.id,
    questId: quest.id,
    missionId: typeof quest.missionId === "string" ? quest.missionId : null,
    title: sanitizeText(quest.title, 180),
    project: sanitizeText(quest.project, 100),
    priority: ["must", "should", "could"].includes(quest.priority) ? quest.priority : "should",
    state,
    status: state,
    execution: quest.execution === "sequential" ? "sequential" : "independent",
    dependsOn: Array.isArray(quest.dependsOn) ? quest.dependsOn.filter((id) => typeof id === "string") : [],
    estimateMinutes: Math.max(5, Math.min(180, Number(quest.estimateMinutes) || 25)),
    durationMinutes: Math.max(5, Math.min(180, Number(quest.estimateMinutes) || 25)),
    remainingMinutes: Math.max(5, Math.min(180, Number(quest.remainingMinutes) || Number(quest.estimateMinutes) || 25)),
    currentAction: sanitizeText(quest.currentAction || quest.firstStep || quest.title, 240),
    steps: Array.isArray(quest.steps) ? quest.steps.map((step) => ({ id: sanitizeText(step?.id, 120), label: sanitizeText(step?.label, 180), completed: Boolean(step?.completed), dependsOn: Array.isArray(step?.dependsOn) ? step.dependsOn.filter((id) => typeof id === "string") : [] })).filter((step) => step.id && step.label) : [],
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
function retainedScheduleBlocks(schedule, at) {
  if (!schedule || !Array.isArray(schedule.blocks)) return [];
  const nowAt = Date.parse(at);
  return schedule.blocks.filter((block) => block?.locked || (typeof block?.endAt === "string" && Date.parse(block.endAt) <= nowAt));
}
async function rebuildSchedule(activityDate) {
  const board = await readJson(boardPath(activityDate));
  if (!board || !Array.isArray(board.quests)) return null;
  const settings = await loadScheduleSettings(DATA_DIR);
  const existingSchedule = await loadSchedule(DATA_DIR, activityDate);
  const generatedAt = koreaNow();
  const tasks = board.quests.map(toTaskCandidate).filter(Boolean);
  const completedQuestIds = board.quests.filter((quest) => (quest?.state || quest?.status) === "completed").map((quest) => quest.id).filter((id) => typeof id === "string");
  const generated = buildDailySchedule({ date: activityDate, settings, taskCandidates: tasks, busyBlocks: [], lockedBlocks: retainedScheduleBlocks(existingSchedule, generatedAt), completedQuestIds, startAt: generatedAt, generatedAt });
  return saveSchedule(DATA_DIR, activityDate, { ...generated, date: activityDate, timezone: "Asia/Seoul", calendar: { coverage: "attention" }, busyBlocks: [] });
}
async function handleSchedule(url) {
  const activityDate = safeDate(url.searchParams.get("date")) || new Date().toISOString().slice(0, 10);
  const schedule = await loadSchedule(DATA_DIR, activityDate) || await rebuildSchedule(activityDate);
  if (!schedule) return { status: 404, body: { error: "No quest board exists for this date." } };
  return { status: 200, body: { schedule, nowFocus: nowFocus(schedule) } };
}
async function handleScheduleRebuild(body) {
  const activityDate = scheduleDate(body);
  const schedule = await rebuildSchedule(activityDate);
  if (!schedule) return { status: 404, body: { error: "No quest board exists for this date." } };
  return { status: 200, body: { schedule, nowFocus: nowFocus(schedule) } };
}
async function handleScheduleBlockReport(body) {
  const activityDate = safeDate(body.activityDate || body.date);
  if (!activityDate) return { status: 400, body: { error: "activityDate and a valid block report are required." } };
  let result;
  try { result = await reportScheduleBlock(DATA_DIR, activityDate, body); } catch (error) { return { status: 400, body: { error: error instanceof Error ? sanitizeText(error.message, 160) : "Invalid block report." } }; }
  if (!result) return { status: 404, body: { error: "No schedule exists for this date." } };
  if (!result.schedule) return { status: 404, body: { error: "Schedule block was not found." } };
  const config = await loadConfig();
  const event = { schemaVersion: 1, id: result.report.id, eventType: "schedule_block_report", activityDate, occurredAt: result.report.occurredAt, source: "daybridge", sensitivity: "sanitized", block: result.report.block, report: { id: result.report.id, occurredAt: result.report.occurredAt, status: result.report.status, note: result.report.note, source: "daybridge" } };
  const mirrored = await writeEvent(config, event);
  return { status: 200, body: { schedule: result.schedule, nowFocus: nowFocus(result.schedule), connection: mirrored ? "connected" : "local", eventRecorded: mirrored } };
}
const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (!request.url) { send(response, 400, { error: "Request URL is required." }, origin); return; }
  if (request.method === "OPTIONS") { send(response, 204, {}, origin); return; }
  const url = new URL(request.url, "http://127.0.0.1:" + PORT);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") { const config = await loadConfig(); send(response, 200, { status: "ok", dataDir: DATA_DIR, handoffSinkDir: config.handoffSinkDir || null, connected: Boolean(config.handoffSinkDir) }, origin); return; }
    if (request.method === "GET" && url.pathname === "/api/board") { const result = await handleBoard(url); send(response, result.status, result.body, origin); return; }
    if (request.method === "POST" && url.pathname === "/api/report") { const result = await handleReport(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    if (request.method === "GET" && url.pathname === "/api/schedule") { const result = await handleSchedule(url); send(response, result.status, result.body, origin); return; }
    if (request.method === "POST" && url.pathname === "/api/schedule/rebuild") { const result = await handleScheduleRebuild(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    if (request.method === "GET" && url.pathname === "/api/schedule-settings") { send(response, 200, { settings: await loadScheduleSettings(DATA_DIR) }, origin); return; }
    if (request.method === "PUT" && url.pathname === "/api/schedule-settings") { const incoming = await readRequestBody(request); const current = await loadScheduleSettings(DATA_DIR); send(response, 200, { settings: await saveScheduleSettings(DATA_DIR, { ...current, ...incoming }) }, origin); return; }
    if (request.method === "POST" && url.pathname === "/api/schedule/block-report") { const result = await handleScheduleBlockReport(await readRequestBody(request)); send(response, result.status, result.body, origin); return; }
    send(response, 404, { error: "Not found." }, origin);
  } catch (error) { send(response, 500, { error: error instanceof Error ? sanitizeText(error.message, 160) : "Unexpected bridge error." }, origin); }
});
await mkdir(join(DATA_DIR, "boards"), { recursive: true });
server.listen(PORT, "127.0.0.1", () => console.log("Daybridge local bridge listening on http://127.0.0.1:" + PORT));
