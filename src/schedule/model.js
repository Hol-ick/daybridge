const KST = "Asia/Seoul";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KST_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;
const PRIORITIES = new Set(["must", "should", "could"]);
const STATES = new Set(["ready", "in_progress", "deferred", "blocked", "completed"]);
const BLOCK_TYPES = new Set(["focus", "busy", "buffer"]);

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function safeSourceRefs(value) {
  return (Array.isArray(value) ? value : [])
    .filter((reference) => typeof reference === "string" && reference.trim())
    .map((reference) => reference.trim())
    .filter((reference) => !/(?:\b[A-Z]:[\\/]|\\\\)/i.test(reference));
}

function blockTime(value, field) {
  if (typeof value !== "string" || !KST_ISO_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${field} must be a Korea-time ISO timestamp (+09:00)`);
  }
  return Date.parse(value);
}

function cloneBlock(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id.trim()) {
    throw new TypeError("Each schedule block needs a stable id");
  }
  if (!BLOCK_TYPES.has(raw.type)) throw new TypeError(`Unsupported schedule block type: ${raw.type}`);
  if (raw.type === "focus" && (typeof raw.questId !== "string" || !raw.questId.trim())) {
    throw new TypeError("Focus blocks need a questId");
  }
  const start = blockTime(raw.startAt, "startAt");
  const end = blockTime(raw.endAt, "endAt");
  if (end <= start) throw new RangeError("A schedule block must end after it starts");
  return { ...raw, id: raw.id.trim(), startAt: raw.startAt, endAt: raw.endAt, locked: Boolean(raw.locked) };
}

export function toTaskCandidate(quest) {
  if (!quest || typeof quest !== "object") return null;
  const id = typeof quest.id === "string" ? quest.id.trim() : "";
  const title = typeof quest.title === "string" ? quest.title.trim() : "";
  const state = quest.state || quest.status || "ready";
  const estimateMinutes = Number(quest.estimateMinutes);
  if (!id || !title || state === "completed" || !STATES.has(state) || !positiveInteger(estimateMinutes)) return null;

  const remaining = quest.remainingMinutes == null ? estimateMinutes : Number(quest.remainingMinutes);
  if (!positiveInteger(remaining)) return null;
  return {
    id,
    title,
    priority: PRIORITIES.has(quest.priority) ? quest.priority : "should",
    state,
    estimateMinutes,
    remainingMinutes: Math.min(remaining, estimateMinutes),
    dependsOn: [...new Set((Array.isArray(quest.dependsOn) ? quest.dependsOn : []).filter((dependency) => typeof dependency === "string" && dependency.trim()).map((dependency) => dependency.trim()))],
    execution: quest.execution === "sequential" ? "sequential" : "independent",
    sourceRefs: safeSourceRefs(quest.sourceRefs),
  };
}

export function createScheduleShell({ date, generatedAt } = {}) {
  if (!DATE_PATTERN.test(date || "")) throw new TypeError("DailySchedule needs a YYYY-MM-DD date");
  const created = generatedAt || `${date}T00:00:00+09:00`;
  blockTime(created, "generatedAt");
  return { schemaVersion: 1, date, timezone: KST, generatedAt: created, blocks: [], unscheduled: [] };
}

export function normalizeSchedule(rawSchedule) {
  const shell = createScheduleShell(rawSchedule);
  if (rawSchedule?.timezone && rawSchedule.timezone !== KST) throw new TypeError("DailySchedule timezone must be Asia/Seoul");
  const blocks = (Array.isArray(rawSchedule?.blocks) ? rawSchedule.blocks : []).map(cloneBlock);
  for (const block of blocks) {
    if (!block.startAt.startsWith(`${shell.date}T`) || !block.endAt.startsWith(`${shell.date}T`)) {
      throw new RangeError("Schedule blocks must stay within the schedule date");
    }
  }
  blocks.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || left.id.localeCompare(right.id));
  for (let index = 1; index < blocks.length; index += 1) {
    if (Date.parse(blocks[index].startAt) < Date.parse(blocks[index - 1].endAt)) {
      throw new RangeError(`DailySchedule blocks overlap: ${blocks[index - 1].id} and ${blocks[index].id}`);
    }
  }
  const unscheduled = (Array.isArray(rawSchedule?.unscheduled) ? rawSchedule.unscheduled : []).map((item) => ({
    questId: String(item?.questId || ""),
    reason: String(item?.reason || "unknown"),
    remainingMinutes: Number(item?.remainingMinutes || 0),
  })).filter((item) => item.questId && positiveInteger(item.remainingMinutes));
  return { ...shell, ...rawSchedule, timezone: KST, blocks, unscheduled };
}

export function isKstIso(value) {
  return typeof value === "string" && KST_ISO_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}
