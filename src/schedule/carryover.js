const CARRYOVER_STATUSES = new Set(["planned", "in_progress", "deferred"]);

function positiveMinutes(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function blockMinutes(block, todoMode) {
  if (todoMode) return 25;
  const start = Date.parse(block?.startAt || "");
  const end = Date.parse(block?.endAt || "");
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? Math.max(5, Math.round((end - start) / 60_000))
    : 50;
}

function taskIdFor(block) {
  return typeof block?.questId === "string" && block.questId
    ? block.questId
    : typeof block?.taskId === "string" && block.taskId
      ? block.taskId
      : "";
}

function normalizedState(state) {
  return state === "in_progress" ? "in_progress" : state === "deferred" ? "deferred" : "ready";
}

/**
 * Convert the previous day's still-open schedule units into candidates for the
 * next day's planner. Completed/skipped blocks never cross the date boundary.
 */
export function carryoverTaskCandidates(schedule) {
  if (!schedule || !Array.isArray(schedule.blocks)) return [];
  const todoMode = schedule.mode === "todo" || schedule.timeConfigured === false;
  const entries = new Map();

  for (const block of schedule.blocks) {
    if (block?.type !== "focus" || !CARRYOVER_STATUSES.has(block.status)) continue;
    const id = taskIdFor(block);
    if (!id) continue;
    const existing = entries.get(id) || {
      id,
      title: typeof block.title === "string" && block.title.trim() ? block.title.trim() : id,
      priority: ["must", "should", "could"].includes(block.priority) ? block.priority : "should",
      sourceKind: block.sourceKind === "routine" ? "routine" : block.sourceKind === "session" ? "session" : "briefing",
      state: "ready",
      remainingMinutes: 0,
    };
    if (block.status === "in_progress" || existing.state !== "in_progress" && block.status === "deferred") {
      existing.state = normalizedState(block.status);
    }
    existing.remainingMinutes += blockMinutes(block, todoMode);
    entries.set(id, existing);
  }

  for (const item of Array.isArray(schedule.unscheduled) ? schedule.unscheduled : []) {
    const id = typeof item?.questId === "string" ? item.questId : "";
    const remainingMinutes = positiveMinutes(item?.remainingMinutes);
    if (!id || !remainingMinutes) continue;
    const existing = entries.get(id) || {
      id,
      title: id,
      priority: "should",
      sourceKind: "briefing",
      state: "ready",
      remainingMinutes: 0,
    };
    existing.remainingMinutes += remainingMinutes;
    entries.set(id, existing);
  }

  return [...entries.values()].map((entry) => ({
    ...entry,
    title: entry.title,
    scheduleTitle: entry.title,
    status: entry.state,
    focusUnits: Math.max(1, Math.ceil(entry.remainingMinutes / 50)),
    remainingUnits: Math.max(1, Math.ceil(entry.remainingMinutes / 50)),
    estimateMinutes: Math.max(5, entry.remainingMinutes),
    durationMinutes: Math.max(5, entry.remainingMinutes),
    currentAction: entry.title,
    steps: [],
    dependsOn: [],
    execution: "independent",
    carryoverCount: 1,
    sourceLabel: "전날 미완료 일정",
    sourcePath: `daybridge://carryover/${schedule.date || "unknown"}`,
  }));
}

