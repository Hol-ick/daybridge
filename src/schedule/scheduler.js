import { createScheduleShell, isKstIso, normalizeSchedule, toTaskCandidate } from "./model.js";

const PRIORITY_WEIGHT = { must: 0, should: 1, could: 2 };
const DEFAULT_BREAKS = Object.freeze([
  { start: "11:30", end: "13:00", label: "점심시간" },
]);

function atKst(date, time) {
  if (!/^\d{2}:\d{2}$/.test(time || "")) throw new TypeError("Schedule settings need HH:MM times");
  return `${date}T${time}:00+09:00`;
}

function normalizedSettings(date, supplied = {}) {
  // The user-facing grid is intentionally one fixed unit: HH:00–HH:50.
  // Older settings may still contain 25-minute values; they are migrated here.
  const focusDurations = [50];
  const bufferMinutes = supplied.bufferMinutes == null ? 10 : Number(supplied.bufferMinutes);
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 30) throw new TypeError("bufferMinutes must be between 0 and 30");
  const dayStart = supplied.dayStart || "09:00";
  const dayEnd = supplied.dayEnd || "18:00";
  const dayStartAt = atKst(date, dayStart);
  const dayEndAt = atKst(date, dayEnd);
  if (Date.parse(dayEndAt) <= Date.parse(dayStartAt)) throw new RangeError("dayEnd must be after dayStart");
  const suppliedBreaks = Array.isArray(supplied.breaks) && supplied.breaks.length ? supplied.breaks : DEFAULT_BREAKS;
  const breaks = suppliedBreaks.map((item, index) => {
    const start = typeof item?.start === "string" ? item.start : "";
    const end = typeof item?.end === "string" ? item.end : "";
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start >= end) throw new TypeError(`break ${index + 1} needs valid start/end times`);
    return { start, end, label: String(item?.label || "휴식 시간") };
  });
  return { dayStart, dayEnd, dayStartAt, dayEndAt, focusDurations, bufferMinutes, breaks };
}

function toBusyBlock(raw, index) {
  if (!raw || typeof raw !== "object" || !isKstIso(raw.startAt) || !isKstIso(raw.endAt)) throw new TypeError("Busy blocks need Korea-time ISO ranges");
  if (Date.parse(raw.endAt) <= Date.parse(raw.startAt)) throw new RangeError("Busy blocks must end after they start");
  return { id: String(raw.id || `busy-${index + 1}`), type: "busy", startAt: raw.startAt, endAt: raw.endAt, locked: true, hidden: Boolean(raw.hidden), title: raw.title || raw.label || undefined };
}

function dedupeBusyBlocks(blocks) {
  const ordered = [...blocks].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  const merged = [];
  for (const block of ordered) {
    const previous = merged.at(-1);
    if (previous && Date.parse(block.startAt) <= Date.parse(previous.endAt)) {
      if (Date.parse(block.endAt) > Date.parse(previous.endAt)) previous.endAt = block.endAt;
      previous.sourceIds = [...new Set([...(previous.sourceIds || [previous.id]), block.id])];
      previous.hidden = Boolean(previous.hidden && block.hidden);
    } else merged.push({ ...block });
  }
  return merged;
}

function dateBounded(block, date) {
  return block.startAt.startsWith(`${date}T`) && block.endAt.startsWith(`${date}T`);
}

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
    .filter((block) => block.type !== "focus" || !breakBlocks.some((breakBlock) => Date.parse(block.startAt) < Date.parse(breakBlock.endAt) && Date.parse(block.endAt) > Date.parse(breakBlock.startAt)));
  return normalizeSchedule({ ...createScheduleShell({ date }), blocks: [...busy, ...locked] }).blocks;
}

function availableSlot(occupied, startMs, endMs, durationMinutes) {
  const hour = 60 * 60_000;
  const alignToHour = (value) => Math.ceil(value / hour) * hour;
  let cursor = alignToHour(startMs);
  for (const block of occupied) {
    const blockStart = Date.parse(block.startAt);
    const blockEnd = Date.parse(block.endAt);
    if (blockEnd <= cursor) continue;
    if (blockStart - cursor >= durationMinutes * 60_000 && cursor + durationMinutes * 60_000 <= endMs) return [cursor, cursor + durationMinutes * 60_000];
    cursor = alignToHour(Math.max(cursor, blockEnd));
  }
  return endMs - cursor >= durationMinutes * 60_000 ? [cursor, cursor + durationMinutes * 60_000] : null;
}

function directBufferSlot(occupied, startMs, endMs, bufferMinutes) {
  if (!bufferMinutes) return null;
  const end = startMs + bufferMinutes * 60_000;
  if (end > endMs) return null;
  const collision = occupied.some((block) => Date.parse(block.startAt) < end && Date.parse(block.endAt) > startMs);
  return collision ? null : [startMs, end];
}

function asKstIso(milliseconds) {
  const koreaClock = new Date(milliseconds + 9 * 60 * 60 * 1000);
  const two = (value) => String(value).padStart(2, "0");
  return `${koreaClock.getUTCFullYear()}-${two(koreaClock.getUTCMonth() + 1)}-${two(koreaClock.getUTCDate())}T${two(koreaClock.getUTCHours())}:${two(koreaClock.getUTCMinutes())}:${two(koreaClock.getUTCSeconds())}+09:00`;
}

function orderedCandidates(candidates, completedQuestIds) {
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
    eligible.sort((left, right) => (left.sourceKind === "routine") - (right.sourceKind === "routine") || PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority] || left.id.localeCompare(right.id));
    const next = eligible[0];
    pending.splice(pending.indexOf(next), 1);
    ordered.push(next);
    ready.add(next.id);
  }
  return { ordered, blocked };
}

function scheduledFocusMinutes(blocks, questId) {
  return blocks.filter((block) => block.type === "focus" && block.questId === questId)
    .reduce((total, block) => total + Math.round((Date.parse(block.endAt) - Date.parse(block.startAt)) / 60_000), 0);
}

export function buildDailySchedule({ date, settings, taskCandidates = [], busyBlocks = [], lockedBlocks = [], completedQuestIds = [], startAt, generatedAt } = {}) {
  const shell = createScheduleShell({ date, generatedAt });
  const config = normalizedSettings(date, settings);
  const dayStartMs = Math.max(Date.parse(config.dayStartAt), startAt && isKstIso(startAt) ? Date.parse(startAt) : -Infinity);
  const dayEndMs = Date.parse(config.dayEndAt);
  if (dayStartMs >= dayEndMs) return normalizeSchedule({ ...shell, unscheduled: taskCandidates.map((quest) => ({ questId: quest.id, reason: "outside_schedule_window", remainingMinutes: quest.remainingMinutes || quest.estimateMinutes })).filter((item) => item.questId && item.remainingMinutes) });

  const constraints = makeConstraints({ date, busyBlocks, lockedBlocks, breaks: config.breaks });
  const candidates = taskCandidates.map(toTaskCandidate).filter(Boolean).filter((candidate) => candidate.state !== "blocked");
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const ordering = orderedCandidates(candidates, completedQuestIds);
  const blocks = [...constraints];
  const unscheduled = [];
  const satisfiedDependencies = new Set(completedQuestIds);

  for (const blocked of ordering.blocked) {
    unscheduled.push({ questId: blocked.id, reason: blocked.dependsOn.some((dependency) => candidateIds.has(dependency)) ? "dependency_unmet" : "dependency_missing", remainingMinutes: blocked.remainingMinutes });
  }

  for (let candidateIndex = 0; candidateIndex < ordering.ordered.length; candidateIndex += 1) {
    const candidate = ordering.ordered[candidateIndex];
    if (!candidate.dependsOn.every((dependency) => satisfiedDependencies.has(dependency))) {
      unscheduled.push({ questId: candidate.id, reason: "dependency_unmet", remainingMinutes: candidate.remainingMinutes });
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
      blocks.push({ id: `focus-${candidate.id}-${focusIndex}`, type: "focus", questId: candidate.id, title: candidate.title, priority: candidate.priority, sourceKind: candidate.sourceKind, category: candidate.category, startAt: asKstIso(start), endAt: asKstIso(end), locked: false });
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
    if (remaining > 0) unscheduled.push({ questId: candidate.id, reason: "insufficient_time", remainingMinutes: remaining });
    else satisfiedDependencies.add(candidate.id);
  }
  return normalizeSchedule({ ...shell, blocks, unscheduled });
}

/**
 * Return the fixed HH:00–HH:50 focus units available for a date. Hidden
 * breaks (including the default 11:30–13:00 lunch window) are treated as
 * occupied but are never returned as user-facing work blocks.
 */
export function getAvailableFocusSlots({ date, settings, busyBlocks = [], focusBlocks = [] } = {}) {
  const config = normalizedSettings(date, settings);
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

function isOpenFocus(block) {
  return block.type === "focus" && !["completed", "skipped", "deferred"].includes(block.status);
}

function nextFocus(schedule, nowMs) {
  return schedule.blocks.find((block) => isOpenFocus(block) && Date.parse(block.startAt) > nowMs) || null;
}

export function resolveNowFocus(schedule, now) {
  const normalized = normalizeSchedule(schedule);
  if (!isKstIso(now)) throw new TypeError("resolveNowFocus needs a Korea-time ISO timestamp");
  const nowMs = Date.parse(now);
  const active = normalized.blocks.find((block) => Date.parse(block.startAt) <= nowMs && nowMs < Date.parse(block.endAt) && (block.type !== "focus" || isOpenFocus(block)));
  if (active?.type === "focus") return { state: "active_focus", block: active, nextFocus: nextFocus(normalized, nowMs) };
  if (active?.type === "busy") return { state: "in_busy_time", block: active, nextFocus: nextFocus(normalized, nowMs) };
  const upcoming = nextFocus(normalized, nowMs);
  if (upcoming) return { state: "up_next", block: upcoming, minutesUntil: Math.max(0, Math.round((Date.parse(upcoming.startAt) - nowMs) / 60_000)) };
  return { state: "free_time", block: null, nextFocus: null };
}

export function rebuildRemainingSchedule({ schedule, now, taskCandidates = [], busyBlocks = [], lockedBlocks = [], settings, completedQuestIds = [] } = {}) {
  const previous = normalizeSchedule(schedule);
  if (!isKstIso(now)) throw new TypeError("rebuildRemainingSchedule needs a Korea-time ISO timestamp");
  const nowMs = Date.parse(now);
  const retained = previous.blocks.filter((block) => !block.hidden && (block.locked || block.type === "busy" || Date.parse(block.startAt) < nowMs));
  const candidateById = new Map(taskCandidates.map(toTaskCandidate).filter(Boolean).map((candidate) => [candidate.id, candidate]));
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
