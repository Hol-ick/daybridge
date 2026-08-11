import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const PORT = Number(process.env.DAYBRIDGE_BRIDGE_PORT || 39393);
const APP_DATA = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
const DATA_DIR = resolve(process.env.DAYBRIDGE_DATA_DIR || join(APP_DATA, "Daybridge"));
const CONFIG_PATH = join(DATA_DIR, "config.json");
const VALID_STATUSES = new Set(["not_started", "in_progress", "completed", "blocked", "paused", "needs_confirmation"]);
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
  return value.filter((step) => step && typeof step.id === "string" && known.has(step.id)).map((step) => ({ id: step.id, label: sanitizeText(known.get(step.id).label, 180), completed: Boolean(step.completed) }));
}
function responseBody(board, connection, eventRecorded = false) { return { board, connection, eventRecorded }; }
async function readRequestBody(request) {
  const chunks = []; let total = 0;
  for await (const chunk of request) { total += chunk.length; if (total > 128 * 1024) throw new Error("Request body is too large."); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("Request body must be valid JSON."); }
}
const allowedOrigins = new Set(["http://127.0.0.1:4173", "http://localhost:4173", "http://127.0.0.1:5173", "http://localhost:5173"]);
function send(response, status, payload, origin) {
  response.writeHead(status, { "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "http://127.0.0.1:4173", "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
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
  quest.status = status; quest.steps = normalizeSteps(body.steps, Array.isArray(quest.steps) ? quest.steps : []); quest.updatedAt = now();
  const report = { id: randomUUID(), occurredAt: quest.updatedAt, status, note: sanitizeText(body.note), nextAction: sanitizeText(body.nextAction, 240), source: "daybridge" };
  quest.reports = [...(Array.isArray(quest.reports) ? quest.reports : []), report].slice(-20); board.generatedAt = now(); board.sourceCoverage = "connected";
  const config = await loadConfig(); await atomicWrite(path, board); await atomicWrite(join(DATA_DIR, "boards", "latest.json"), board);
  const event = { schemaVersion: 1, id: report.id, eventType: "quest_status_report", activityDate, occurredAt: report.occurredAt, source: "daybridge", sensitivity: "sanitized", quest: { id: quest.id, title: sanitizeText(quest.title, 180), project: sanitizeText(quest.project, 100), status: quest.status, firstStep: sanitizeText(quest.firstStep, 240), doneWhen: sanitizeText(quest.doneWhen, 240), sourceLabel: sanitizeText(quest.sourceLabel, 100), sourcePath: sanitizeText(quest.sourcePath, 220) }, report };
  const mirrored = await writeEvent(config, event);
  return { status: 200, body: responseBody(board, mirrored ? "connected" : "local", mirrored) };
}
async function handleBoard(url) {
  const requestedDate = safeDate(url.searchParams.get("date")) || new Date().toISOString().slice(0, 10); const board = await readJson(boardPath(requestedDate));
  if (!board) return { status: 404, body: { error: "No quest board exists for this date." } };
  const config = await loadConfig(); const connected = typeof config.handoffSinkDir === "string" && config.handoffSinkDir.trim().length > 0;
  return { status: 200, body: responseBody(board, connected ? "connected" : "local") };
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
    send(response, 404, { error: "Not found." }, origin);
  } catch (error) { send(response, 500, { error: error instanceof Error ? sanitizeText(error.message, 160) : "Unexpected bridge error." }, origin); }
});
await mkdir(join(DATA_DIR, "boards"), { recursive: true });
server.listen(PORT, "127.0.0.1", () => console.log("Daybridge local bridge listening on http://127.0.0.1:" + PORT));
