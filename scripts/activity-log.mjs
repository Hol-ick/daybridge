import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWriteJson, readJsonStrict, StoreError } from "./storage/json-store.mjs";
import { runStoreOperation } from "./storage/date-transaction.mjs";
import { transactionContext } from "./storage/transaction-context.mjs";

const ACTIONS = new Set(["task_added", "status_changed", "task_reordered", "task_removed", "schedule_rebuilt", "schedule_settings_changed", "daily_defaults_changed"]);
const ACTION_LABELS = {
  task_added: "작업 추가",
  status_changed: "상태 변경",
  task_reordered: "순서 변경",
  task_removed: "오늘 목록에서 제거",
  schedule_rebuilt: "일정 재배치",
  schedule_settings_changed: "시간표 설정 변경",
  daily_defaults_changed: "매일 기본 일정 변경",
};
const STATUS_LABELS = { planned: "미완료", ready: "미완료", in_progress: "진행 중", completed: "완료", deferred: "보류", skipped: "건너뜀" };
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phonePattern = /(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g;
const secretPattern = /(\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret|cookie|session[_ -]?token|private[_ -]?key)\b\s*[:=]\s*)(['"]?)[^\s'"]{8,}/gi;
const localPathPattern = /\b[A-Z]:\\[^\s|]+/gi;
const DETAIL_KEYS = new Set(["durationMinutes", "status", "previousStatus", "position", "targetTitle", "targetBlockId", "startAt", "endAt", "mode", "timeConfigured", "dayStart", "dayEnd", "bufferMinutes", "reason", "count", "carryoverCount", "automatic"]);

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new TypeError("activityDate must use YYYY-MM-DD.");
  return value;
}

function sanitizeText(value, limit = 240) {
  const text = String(value || "")
    .replace(emailPattern, "[email removed]")
    .replace(phonePattern, "[phone removed]")
    .replace(secretPattern, "$1[sensitive value removed]")
    .replace(localPathPattern, "[local path]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function activityPath(dataDir, date) { return join(dataDir, "activity", `${date}.ndjson`); }
function activityMarkdownPath(dataDir, date) { return join(dataDir, "activity", `${date}.md`); }

function normalizeDetails(input) {
  const details = {};
  for (const [key, value] of Object.entries(input && typeof input === "object" ? input : {})) {
    if (!DETAIL_KEYS.has(key)) continue;
    if (typeof value === "string") details[key] = sanitizeText(value, 240);
    else if (typeof value === "number" || typeof value === "boolean") details[key] = value;
  }
  return details;
}

function normalizeRecord(input) {
  const activityDate = assertDate(input?.activityDate);
  if (!ACTIONS.has(input?.action)) throw new TypeError("Unsupported activity action.");
  const occurredAt = typeof input?.occurredAt === "string" && Number.isFinite(Date.parse(input.occurredAt)) ? input.occurredAt : new Date().toISOString();
  const subject = input?.subject && typeof input.subject === "object" ? input.subject : {};
  return {
    schemaVersion: 1,
    id: typeof input?.id === "string" && input.id ? sanitizeText(input.id, 120) : randomUUID(),
    activityDate,
    occurredAt,
    source: "daybridge",
    sensitivity: "sanitized",
    action: input.action,
    subject: {
      type: sanitizeText(subject.type || "task", 40) || "task",
      id: sanitizeText(subject.id, 120) || null,
      questId: sanitizeText(subject.questId, 120) || null,
      title: sanitizeText(subject.title, 180) || "일정",
    },
    details: normalizeDetails(input?.details),
  };
}

function koreaTime(occurredAt) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(occurredAt));
}

function detailText(record) {
  const details = record.details || {};
  if (record.action === "status_changed" && details.status) return ` → ${STATUS_LABELS[details.status] || details.status}${details.automatic ? " · 자동 전환" : ""}`;
  if (record.action === "task_reordered" && details.targetTitle) return ` · ${details.targetTitle} ${details.position === "before" ? "앞" : "뒤"}`;
  if (record.action === "task_added" && Number.isFinite(details.durationMinutes)) return ` · ${details.durationMinutes}분`;
  if (record.action === "schedule_settings_changed") return details.timeConfigured ? ` · ${details.dayStart}–${details.dayEnd}` : " · 시간 미배정 목록";
  if (record.action === "daily_defaults_changed" && Number.isFinite(details.count)) return ` · ${details.count}개`;
  return "";
}

function renderMarkdown(activityDate, records) {
  const lines = [
    `# Daybridge 활동 로그 — ${activityDate}`,
    "",
    "> 위젯에서 성공한 추가·상태 변경·재배치·삭제·설정 조작을 기록합니다.",
    "",
  ];
  if (!records.length) lines.push("- 아직 기록된 조작이 없습니다.");
  else for (const record of records) lines.push(`- ${koreaTime(record.occurredAt)} · **${ACTION_LABELS[record.action]}** · ${record.subject.title}${detailText(record)}`);
  return `${lines.join("\n")}\n`;
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, path);
}

async function readAll(dataDir, activityDate) {
  const date = assertDate(activityDate);
  let raw = "";
  try { raw = await readFile(activityPath(dataDir, date), "utf8"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const records = raw.split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      const record = JSON.parse(line);
      if (record?.activityDate !== date || !ACTIONS.has(record?.action)) throw new Error("invalid activity");
      return record;
    } catch (error) { throw new StoreError("corrupt_activity", "Activity history is damaged; preserve the original file.", error); }
  });
  const committed = await readJsonStrict(join(dataDir, "activity", `${date}.json`));
  if (committed && (committed.schemaVersion !== 1 || committed.activityDate !== date || !Array.isArray(committed.records)
      || committed.records.some(r => r?.activityDate !== date || !ACTIONS.has(r?.action) || typeof r.id !== "string"))) {
    throw new StoreError("corrupt_activity", "Committed activity history is invalid; preserve the original file.");
  }
  const merged = new Map(records.map(r => [r.id, r]));
  for (const record of committed?.records || []) merged.set(record.id, record);
  return [...merged.values()];
}

export async function readActivityLog(dataDir, activityDate, { limit = 200 } = {}) {
  return await runStoreOperation(dataDir, assertDate(activityDate), async () => (await readAll(dataDir, activityDate)).slice(-Math.max(1, Math.min(500, Number(limit) || 200))));
}

export async function projectActivityLog(dataDir, activityDate) {
  // JSON is the committed authority; text exports are repairable projections.
  // Keep legacy NDJSON untouched so migration never destroys its evidence.
  return await runStoreOperation(dataDir, assertDate(activityDate), async () => {
    const records = await readAll(dataDir, activityDate);
    await atomicWrite(join(dataDir, "activity", `${activityDate}.committed.ndjson`), records.map(r => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
    await atomicWrite(activityMarkdownPath(dataDir, activityDate), renderMarkdown(activityDate, records));
    const path = join(dataDir, "activity", `${activityDate}.json`);
    const committed = await readJsonStrict(path);
    if (committed?.projectionPending) await atomicWriteJson(path, { ...committed, projectionPending: false });
  });
}

export async function repairActivityProjections(dataDir, { limit = 20 } = {}) {
  let names;
  try { names = await readdir(join(dataDir, "activity")); }
  catch (error) { if (error.code === "ENOENT") return { repaired: 0, failed: 0 }; throw error; }
  let repaired = 0;
  let failed = 0;
  for (const name of names.filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
    if (repaired + failed >= limit) break;
    try {
      const record = await readJsonStrict(join(dataDir, "activity", name));
      if (!record?.projectionPending) continue;
      await projectActivityLog(dataDir, name.slice(0, 10));
      repaired++;
    } catch { failed++; }
  }
  return { repaired, failed };
}

export async function recordActivity(dataDir, input) {
  const record = normalizeRecord(input);
  const nested = Boolean(transactionContext.getStore());
  await runStoreOperation(dataDir, record.activityDate, async () => {
    const records = await readAll(dataDir, record.activityDate);
    if (!records.some(r => r.id === record.id)) records.push(record);
    await atomicWriteJson(join(dataDir, "activity", `${record.activityDate}.json`), { schemaVersion: 1, activityDate: record.activityDate, records, projectionPending: true });
  });
  if (!nested) await projectActivityLog(dataDir, record.activityDate).catch(() => {});
  return record;
}
