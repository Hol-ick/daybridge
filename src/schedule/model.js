const KST = "Asia/Seoul";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KST_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;
const PRIORITIES = new Set(["must", "should", "could"]);
const STATES = new Set(["ready", "in_progress", "deferred", "blocked", "completed"]);
const BLOCK_TYPES = new Set(["focus", "busy", "buffer"]);

const SCHEDULE_TITLE_LIMIT = 32;
const SCHEDULE_TITLE_RULES = [
  [/^\s*리눅스(?:\s|$)/i, "리눅스 학습"],
  [/(?:supabase.*(?:스키마|백업)|(?:스키마|백업).*supabase)/i, "Supabase 백업 확인"],
  [/(?:kiosk.*(?:e2e|라이브 주문|실행 조건)|(?:e2e|라이브 주문|실행 조건).*kiosk)/i, "Kiosk 주문 검증"],
  [/(?:kiosk.*(?:migration|저장|고객 반영)|(?:migration|고객 반영).*kiosk)/i, "Kiosk 배포 검증"],
  [/(?:고객.*(?:택배 접수|매입가 카드)|택배 접수.*고객)/i, "고객 택배 접수 검증"],
  [/(?:대화|세션).*coverage|coverage.*(?:대화|세션)/i, "대화 coverage 확인"],
  [/(?:github actions|verify web[- ]?buyback|배포 상태)/i, "배포 상태 확인"],
  [/(?:review.*review[- ]?large|review[- ]?large.*review)/i, "문서 검토"],
  [/(?:current[_ ]context)/i, "현재 맥락 확인"],
  [/(?:실패.*(?:run|step|로그)|(?:run|step).*실패)/i, "실패 로그 확인"],
  [/(?:번역 대상|자연어 품질)/i, "번역 품질 검토"],
  [/(?:운영\s*db|운영\s*database).*검증|upstream[_ -]?unavailable/i, "운영 DB 검증 확인"],
  [/(?:일일 보고서|closeout)/i, "일일 보고서 정리"],
];

function cleanScheduleText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:\[[^\]]+\]|(?:내일 첫 행동|확인 필요))\s*[:：-]?\s*/i, "")
    .trim();
}

/**
 * Converts briefing prose into a short action label for the time grid.
 * The original quest remains available on the board; only the schedule
 * boundary receives this compact, privacy-safe label.
 */
export function toScheduleTitle(questOrTitle) {
  const explicit = typeof questOrTitle === "object" && questOrTitle !== null
    ? questOrTitle.scheduleTitle || questOrTitle.displayTitle || questOrTitle.title
    : questOrTitle;
  const text = cleanScheduleText(explicit);
  if (!text) return "집중 작업";

  for (const [pattern, replacement] of SCHEDULE_TITLE_RULES) {
    if (pattern.test(text)) return replacement;
  }

  if (text.length <= SCHEDULE_TITLE_LIMIT) return text;

  const firstSentence = text.split(/[.!?]/, 1)[0].trim();
  const actionMatch = firstSentence.match(/^(.{2,40}?(?:학습|확인|검증|정리|작성|기록|준비|확보|점검|실행|연동|배포|수정|테스트|결정|검토))(?:\s|$)/i);
  const compact = (actionMatch?.[1] || firstSentence)
    .replace(/(?:해야 한다|해야 함|필요|요청|진행)\s*$/i, "")
    .trim();
  if (compact.length <= SCHEDULE_TITLE_LIMIT) return compact;
  return `${compact.slice(0, SCHEDULE_TITLE_LIMIT - 1).trimEnd()}…`;
}

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
  const rawTitle = typeof (quest.scheduleTitle || quest.displayTitle || quest.title) === "string"
    ? (quest.scheduleTitle || quest.displayTitle || quest.title).trim()
    : "";
  const title = rawTitle ? toScheduleTitle(quest) : "";
  const state = quest.state || quest.status || "ready";
  const focusUnits = Number(quest.focusUnits ?? quest.focus_units);
  const estimateMinutes = Number.isInteger(focusUnits) && focusUnits > 0 ? focusUnits * 50 : Number(quest.estimateMinutes);
  if (!id || !title || state === "completed" || !STATES.has(state) || !positiveInteger(estimateMinutes)) return null;

  const remainingUnits = Number(quest.remainingUnits ?? quest.remaining_units);
  const remaining = Number.isInteger(remainingUnits) && remainingUnits > 0
    ? remainingUnits * 50
    : (quest.remainingMinutes == null ? estimateMinutes : Number(quest.remainingMinutes));
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
    sourceKind: quest.sourceKind === "routine" ? "routine" : "briefing",
    category: typeof quest.category === "string" ? quest.category.slice(0, 40) : null,
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
