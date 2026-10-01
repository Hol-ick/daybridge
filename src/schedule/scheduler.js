import { createScheduleShell, isKstIso, normalizeSchedule, toTaskCandidate, isTimedBlock } from "./model.js";

import { normalizeScheduleSettings } from "./settings-contract.js";

const PRIORITY_WEIGHT = { must: 0, should: 1, could: 2 };
const DEFAULT_BREAKS = Object.freeze([
  { start: "11:30", end: "13:00", label: "점심시간" },
]);

/** @param {string | undefined} date @param {string} time */
function atKst(date, time) {
  if (!/^\d{2}:\d{2}$/.test(time || "")) throw new TypeError("Schedule settings need HH:MM times");
  return `${date}T${time}:00+09:00`;
}

/** @param {string | undefined} date @param {import("./types").ScheduleSettingsInput} [supplied] @returns {import("./types").ScheduleSettings & ({timeConfigured: false, dayStartAt: null, dayEndAt: null} | {timeConfigured: true, dayStartAt: string, dayEndAt: string})} */
function normalizedSettings(date, supplied = {}) {
  const normalized = normalizeScheduleSettings(supplied);
  if (!normalized.timeConfigured) return { ...normalized, timeConfigured: false, dayStartAt: null, dayEndAt: null };
  return { ...normalized, timeConfigured: true, dayStartAt: atKst(date, normalized.dayStart), dayEndAt: atKst(date, normalized.dayEnd) };
}

/** @param {Partial<import("./types").ScheduleBlock>} raw @param {number} index @returns {import("./types").TimedBlock} */
function toBusyBlock(raw, index) {
  if (!raw || typeof raw !== "object" || !isKstIso(raw.startAt) || !isKstIso(raw.endAt)) throw new TypeError("Busy blocks need Korea-time ISO ranges");
  if (Date.parse(raw.endAt) <= Date.parse(raw.startAt)) throw new RangeError("Busy blocks must end after they start");
  return { id: String(raw.id || `busy-${index + 1}`), type: "busy", startAt: raw.startAt, endAt: raw.endAt, locked: true, hidden: Boolean(raw.hidden), title: raw.title || raw.label || undefined };
}

/** @param {import("./types").TimedBlock[]} blocks @returns {import("./types").TimedBlock[]} */
function dedupeBusyBlocks(blocks) {
  const ordered = [...blocks].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  /** @type {import("./types").TimedBlock[]} */
  const merged = [];
  for (const block of ordered) {
    const previous = merged.at(-1);
    if (previous && Date.parse(block.startAt || "") <= Date.parse(previous.endAt)) {
      if (Date.parse(block.endAt || "") > Date.parse(previous.endAt)) previous.endAt = block.endAt;
      previous.sourceIds = [...new Set([...(previous.sourceIds || [previous.id]), block.id])];
      previous.hidden = Boolean(previous.hidden && block.hidden);
    } else merged.push({ ...block });
  }
  return merged;
}

/** @param {import("./types").ScheduleBlock} block @param {string | undefined} date @returns {block is import("./types").TimedBlock} */
function dateBounded(block, date) {
  return isTimedBlock(block) && block.startAt.startsWith(`${date}T`) && block.endAt.startsWith(`${date}T`);
}

/** @param {{date?: string, busyBlocks?: import("./types").ScheduleBlock[], lockedBlocks?: import("./types").ScheduleBlock[], breaks?: readonly import("./types").BreakRange[]}} input @returns {import("./types").TimedBlock[]} */
function makeConstraints({ date, busyBlocks, lockedBlocks, breaks = DEFAULT_BREAKS }) {
  const breakBlocks = breaks.map((item, index) => ({
    id: `lunch-${date}-${index + 1}`,
    startAt: atKst(date, item.start),
    endAt: atKst(date, item.end),
    label: item.label,
    hidden: true,
  }));
  const busy = dedupeBusyBlocks([...(busyBlocks || []), ...breakBlocks].map(toBusyBlock)).filter((block) => dateBounded(block, date));
  const locked = (lockedBlocks || []).map((block, index) => ({ ...block, id: String(block?.id || `locked-${index + 1}`), locked: true }))
    .filter((block) => dateBounded(block, date))
    // A schedule saved before the lunch rule may still contain an old 11:00
    // or 12:00 focus block. Drop that stale placement so the quest can be
    // rebuilt into the next legal HH:00 slot instead of overlapping lunch.
    .filter((block) => block.type !== "focus" || !breakBlocks.some((breakBlock) => Date.parse(block.startAt || "") < Date.parse(breakBlock.endAt) && Date.parse(block.endAt || "") > Date.parse(breakBlock.startAt)));
  return normalizeSchedule({ ...createScheduleShell({ date }), blocks: [...busy, ...locked] }).blocks.filter(isTimedBlock);
}

/** @param {import("./types").TimedBlock[]} occupied @param {number} startMs @param {number} endMs @param {number} durationMinutes @returns {[number, number] | null} */
function availableSlot(occupied, startMs, endMs, durationMinutes) {
  const hour = 60 * 60_000;
  const alignToHour = (/** @type {number} */ value) => Math.ceil(value / hour) * hour;
  let cursor = alignToHour(startMs);
  for (const block of occupied) {
    const blockStart = Date.parse(block.startAt || "");
    const blockEnd = Date.parse(block.endAt || "");
    if (blockEnd <= cursor) continue;
    if (blockStart - cursor >= durationMinutes * 60_000 && cursor + durationMinutes * 60_000 <= endMs) return [cursor, cursor + durationMinutes * 60_000];
    cursor = alignToHour(Math.max(cursor, blockEnd));
  }
  return endMs - cursor >= durationMinutes * 60_000 ? [cursor, cursor + durationMinutes * 60_000] : null;
}

/** @param {import("./types").TimedBlock[]} occupied @param {number} startMs @param {number} endMs @param {number} bufferMinutes @returns {[number, number] | null} */
function directBufferSlot(occupied, startMs, endMs, bufferMinutes) {
  if (!bufferMinutes) return null;
  const end = startMs + bufferMinutes * 60_000;
  if (end > endMs) return null;
  const collision = occupied.some((block) => Date.parse(block.startAt || "") < end && Date.parse(block.endAt || "") > startMs);
  return collision ? null : [startMs, end];
}

/** @param {number} milliseconds */
function asKstIso(milliseconds) {
  const koreaClock = new Date(milliseconds + 9 * 60 * 60 * 1000);
  /** @param {number} value */
  const two = (value) => String(value).padStart(2, "0");
  return `${koreaClock.getUTCFullYear()}-${two(koreaClock.getUTCMonth() + 1)}-${two(koreaClock.getUTCDate())}T${two(koreaClock.getUTCHours())}:${two(koreaClock.getUTCMinutes())}:${two(koreaClock.getUTCSeconds())}+09:00`;
}

/** @param {string} seed @param {string} id */
function stableOrderScore(seed, id) {
  let hash = 2166136261;
  for (const character of `${seed}:${id}`) {
    hash ^= (character.codePointAt(0) ?? 0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** @param {import("./types").TaskCandidate[]} candidates @param {string[]} completedQuestIds */
function orderedCandidates(candidates, completedQuestIds, randomSeed = "") {
  const pending = [...candidates];
  const ready = new Set(completedQuestIds || []);
  const ordered = [];
  const blocked = [];
  while (pending.length) {
    const eligible = pending.filter((candidate) => candidate.dependsOn.every((dependency) => ready.has(dependency)));
    if (!eligible.length) {
      blocked.push(...pending);
      break;
    }
    eligible.sort((left, right) => randomSeed
      ? stableOrderScore(randomSeed, left.id) - stableOrderScore(randomSeed, right.id) || left.id.localeCompare(right.id)
      : Number(left.sourceKind === "routine") - Number(right.sourceKind === "routine") || PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority] || left.id.localeCompare(right.id));
    const next = eligible[0];
    pending.splice(pending.indexOf(next), 1);
    ordered.push(next);
    ready.add(next.id);
  }
  return { ordered, blocked };
}

/** @param {import("./types").ScheduleBlock[]} blocks @param {string} questId */
function scheduledFocusMinutes(blocks, questId) {
  return blocks.filter((block) => block.type === "focus" && block.questId === questId)
    .reduce((total, block) => total + (typeof block.workMinutes === "number" && Number.isFinite(block.workMinutes) && block.workMinutes > 0 ? block.workMinutes : Math.round((Date.parse(block.endAt || "") - Date.parse(block.startAt || "")) / 60_000)), 0);
}

/** @param {import("./types").ScheduleBuildInput} [options] @returns {import("./types").DailySchedule} */
export function buildDailySchedule({ date, settings, taskCandidates = [], busyBlocks = [], lockedBlocks = [], completedQuestIds = [], startAt, generatedAt } = {}) {
  const shell = createScheduleShell({ date, generatedAt });
  const config = normalizedSettings(date, settings);
  const candidates = taskCandidates.map(toTaskCandidate).filter(candidate => candidate !== null).filter((candidate) => candidate.state !== "blocked");
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const satisfiedFromReports = [...new Set([...completedQuestIds, ...candidates.flatMap(candidate => candidate.completedDependencies || []).filter(id => !candidateIds.has(id))])];
  // Untimed days are still a deliberate daily queue. Shuffle only the
  // currently eligible cards with a date seed so independent work feels fresh
  // while the same day remains stable across reloads and dependency chains
  // still stay in A → B → C order.
  const ordering = orderedCandidates(candidates, satisfiedFromReports, config.timeConfigured ? "" : date);
  if (!config.timeConfigured) {
    // Without a configured work window, keep the product useful as a small
    // daily todo list. Items remain actionable/status-reportable, but no
    // synthetic clock times, lunch blocks, or countdown schedule are invented.
    /** @type {import("./types").ScheduleBlock[]} */
    const listItems = [...ordering.ordered, ...ordering.blocked].map((candidate, index) => ({
      id: `todo-${candidate.id}`,
      type: "focus",
      questId: candidate.id,
      workMinutes: candidate.remainingMinutes,
      taskMetadata: { ...candidate },
      title: candidate.title,
      priority: candidate.priority,
      sourceKind: candidate.sourceKind,
      category: candidate.category,
      status: candidate.state === "in_progress" ? "in_progress" : candidate.state === "deferred" ? "deferred" : "planned",
      order: index,
      timed: false,
      locked: false,
    }));
    return normalizeSchedule({ ...shell, mode: "todo", timeConfigured: false, blocks: listItems, unscheduled: [] });
  }
  const dayStartMs = Math.max(Date.parse(config.dayStartAt), startAt && isKstIso(startAt) ? Date.parse(startAt) : -Infinity);
  const dayEndMs = Date.parse(config.dayEndAt);
  if (dayStartMs >= dayEndMs) return normalizeSchedule({ ...shell, timeConfigured: true, unscheduled: taskCandidates.map(toTaskCandidate).filter(candidate => candidate !== null).map((candidate) => ({ questId: candidate.id, taskMetadata: { ...candidate }, reason: "outside_schedule_window", remainingMinutes: candidate.remainingMinutes })) });

  const constraints = makeConstraints({ date, busyBlocks, lockedBlocks, breaks: config.breaks });
  const blocks = [...constraints];
  const unscheduled = [];
  const satisfiedDependencies = new Set(satisfiedFromReports);

  for (const blocked of ordering.blocked) {
    unscheduled.push({ questId: blocked.id, taskMetadata: { ...blocked }, reason: blocked.dependsOn.some((dependency) => candidateIds.has(dependency)) ? "dependency_unmet" : "dependency_missing", remainingMinutes: blocked.remainingMinutes });
  }

  for (let candidateIndex = 0; candidateIndex < ordering.ordered.length; candidateIndex += 1) {
    const candidate = ordering.ordered[candidateIndex];
    if (!candidate.dependsOn.every((dependency) => satisfiedDependencies.has(dependency))) {
      unscheduled.push({ questId: candidate.id, taskMetadata: { ...candidate }, reason: "dependency_unmet", remainingMinutes: candidate.remainingMinutes });
      continue;
    }
    const existingMinutes = scheduledFocusMinutes(blocks, candidate.id);
    let remaining = Math.max(0, candidate.remainingMinutes - existingMinutes);
    let focusIndex = 0;
    while (remaining > 0) {
      const duration = 50;
      const slot = availableSlot(blocks, dayStartMs, dayEndMs, duration);
      if (!slot) break;
      focusIndex += 1;
      const [start, end] = slot;
      blocks.push({ id: `focus-${candidate.id}-${focusIndex}`, type: "focus", questId: candidate.id, workMinutes: Math.min(remaining, duration), taskMetadata: { ...candidate }, title: candidate.title, priority: candidate.priority, sourceKind: candidate.sourceKind, category: candidate.category, status: candidate.state === "in_progress" ? "in_progress" : candidate.state === "deferred" ? "deferred" : "planned", startAt: asKstIso(start), endAt: asKstIso(end), locked: false });
      blocks.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || left.id.localeCompare(right.id));
      remaining = Math.max(0, remaining - duration);
      const laterWorkExists = remaining > 0 || candidateIndex < ordering.ordered.length - 1;
      if (laterWorkExists && config.bufferMinutes) {
        const bufferSlot = directBufferSlot(blocks, end, dayEndMs, config.bufferMinutes);
        if (bufferSlot) {
          const [bufferStart, bufferEnd] = bufferSlot;
          blocks.push({ id: `buffer-after-${candidate.id}-${focusIndex}`, type: "buffer", startAt: asKstIso(bufferStart), endAt: asKstIso(bufferEnd), locked: false });
          blocks.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || left.id.localeCompare(right.id));
        }
      }
    }
    if (remaining > 0) unscheduled.push({ questId: candidate.id, taskMetadata: { ...candidate }, reason: "insufficient_time", remainingMinutes: remaining });
    else satisfiedDependencies.add(candidate.id);
  }
  return normalizeSchedule({ ...shell, timeConfigured: true, blocks, unscheduled });
}

/**
 * Return the fixed HH:00–HH:50 focus units available for a date. Hidden
 * breaks (including the default 11:30–13:00 lunch window) are treated as
 * occupied but are never returned as user-facing work blocks.
 */
/** @param {{date?: string, settings?: import("./types").ScheduleSettingsInput, busyBlocks?: import("./types").ScheduleBlock[], focusBlocks?: import("./types").ScheduleBlock[]}} [options] */
export function getAvailableFocusSlots({ date, settings, busyBlocks = [], focusBlocks = [] } = {}) {
  const config = normalizedSettings(date, settings);
  if (!config.timeConfigured) return [];
  const occupied = makeConstraints({
    date,
    busyBlocks: busyBlocks.filter((block) => block?.type === "busy" || !block?.type),
    lockedBlocks: focusBlocks.filter((block) => block?.type === "focus"),
    breaks: config.breaks,
  }).filter((block) => block.type === "busy" || block.type === "focus");
  const slots = [];
  let slot = availableSlot(occupied, Date.parse(config.dayStartAt), Date.parse(config.dayEndAt), 50);
  while (slot) {
    const [start, end] = slot;
    slots.push({ startAt: asKstIso(start), endAt: asKstIso(end) });
    occupied.push({ id: `available-${slots.length}`, type: "focus", startAt: asKstIso(start), endAt: asKstIso(end) });
    occupied.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || left.id.localeCompare(right.id));
    slot = availableSlot(occupied, Date.parse(config.dayStartAt), Date.parse(config.dayEndAt), 50);
  }
  return slots;
}

/** @param {import("./types").ScheduleBlock} block */
function isOpenFocus(block) {
  return block.type === "focus" && !["completed", "skipped", "deferred"].includes(block.status || "planned");
}

/** @param {import("./types").DailySchedule} schedule @param {number} nowMs */
function nextFocus(schedule, nowMs) {
  return schedule.blocks.filter(isTimedBlock).find((block) => isOpenFocus(block) && Date.parse(block.startAt) > nowMs) || null;
}

/** @param {import("./types").ScheduleInput | undefined} schedule @param {string} now */
export function resolveNowFocus(schedule, now) {
  const normalized = normalizeSchedule(schedule);
  if (!isKstIso(now)) throw new TypeError("resolveNowFocus needs a Korea-time ISO timestamp");
  if (normalized.mode === "todo" || normalized.timeConfigured === false) {
    return { state: "todo_list", block: null, nextFocus: null };
  }
  const nowMs = Date.parse(now);
  const active = normalized.blocks.filter(isTimedBlock).find((block) => Date.parse(block.startAt || "") <= nowMs && nowMs < Date.parse(block.endAt || "") && (block.type !== "focus" || isOpenFocus(block)));
  if (active?.type === "focus") return { state: "active_focus", block: active, nextFocus: nextFocus(normalized, nowMs) };
  if (active?.type === "busy") return { state: "in_busy_time", block: active, nextFocus: nextFocus(normalized, nowMs) };
  const upcoming = nextFocus(normalized, nowMs);
  if (upcoming) return { state: "up_next", block: upcoming, minutesUntil: Math.max(0, Math.round((Date.parse(upcoming.startAt) - nowMs) / 60_000)) };
  return { state: "free_time", block: null, nextFocus: null };
}

/** @param {import("./types").ScheduleBuildInput & {schedule?: import("./types").ScheduleInput, now?: string}} [options] */
export function rebuildRemainingSchedule({ schedule, now, taskCandidates = [], busyBlocks = [], lockedBlocks = [], settings, completedQuestIds = [] } = {}) {
  const previous = normalizeSchedule(schedule);
  if (!isKstIso(now)) throw new TypeError("rebuildRemainingSchedule needs a Korea-time ISO timestamp");
  const nowMs = Date.parse(now);
  const retained = previous.blocks.filter((block) => !block.hidden && (block.locked || block.type === "busy" || Date.parse(block.startAt || "") < nowMs));
  const candidateById = new Map(taskCandidates.map(toTaskCandidate).filter(candidate => candidate !== null).map((candidate) => [candidate.id, candidate]));
  const adjusted = [...candidateById.values()].map((candidate) => {
    const retainedMinutes = scheduledFocusMinutes(retained, candidate.id);
    return { ...candidate, remainingMinutes: Math.max(0, candidate.remainingMinutes - retainedMinutes) };
  }).filter((candidate) => candidate.remainingMinutes > 0);
  const retainedBusy = retained.filter((block) => block.type === "busy");
  const retainedLocked = retained.filter((block) => block.type !== "busy");
  return buildDailySchedule({
    date: previous.date,
    generatedAt: previous.generatedAt,
    settings,
    taskCandidates: adjusted,
    busyBlocks: [...retainedBusy, ...busyBlocks],
    lockedBlocks: [...retainedLocked, ...lockedBlocks],
    completedQuestIds,
    startAt: now,
  });
}
