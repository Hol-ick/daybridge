const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ARTIFACT_TYPE = "daybridge_quest_plan";
const SUPPORTED_SCHEMA_VERSIONS = new Set(["1.0", "1.1"]);
const QUEST_KINDS = new Set(["execute", "review", "decision"]);
const PRIORITIES = new Set(["must", "should", "could"]);
const STATES = new Set(["ready", "in_progress", "deferred", "blocked", "completed"]);
const LEGACY_STATES = new Map([["not_started", "ready"], ["paused", "deferred"]]);
const COVERAGE = new Set(["complete", "attention", "unavailable"]);
const FIXED_TIME_FIELDS = ["start_at", "startAt", "end_at", "endAt"];
const SECRET_PATTERN = /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret|cookie|session[_ -]?token|private[_ -]?key)\s*[:=]\s*[^\s]+/i;
const LOCAL_PATH_PATTERN = /(?:\b[A-Z]:[\\/]|\\\\|<drive>:[\\/])[^\s|]+/i;

export const SCHEDULE_INPUT_ARTIFACT = ARTIFACT_TYPE;
export const SCHEDULE_INPUT_SCHEMA_VERSION = "1.1";
export const FOCUS_UNIT_MINUTES = 50;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** @param {unknown} value @param {number} [limit] */
function text(value, limit = 240) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit).trim() : "";
}

/** @param {unknown} value @returns {unknown[]} */
function list(value) {
  return Array.isArray(value) ? value : [];
}

/** @param {unknown} value */
function uniqueStrings(value) {
  return [...new Set(list(value).filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

/** @param {unknown} value */
function dateValue(value) {
  return typeof value === "string" && DATE_PATTERN.test(value) ? value : null;
}

/** @param {unknown} value */
function positiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** @param {unknown} value */
function units(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/** @param {unknown} value */
function normalizeState(value) {
  const raw = text(value, 40) || "ready";
  return LEGACY_STATES.get(raw) || (STATES.has(raw) ? raw : null);
}

/** @param {Record<string, unknown>} source */
function normalizeCoverage(source) {
  const raw = (isRecord(source.coverage) ? source.coverage.status : null) || source.coverage;
  if (raw === "aligned") return "complete";
  if (raw == null && (source?.quality === "aligned" || source?.record_quality === "aligned")) return "complete";
  return typeof raw === "string" && COVERAGE.has(raw) ? raw : "attention";
}

/** @param {Record<string, unknown>} raw @param {Record<string, unknown>} source */
function sourceRefs(raw, source) {
  const refs = raw?.source_refs ?? raw?.sourceRefs ?? raw?.evidence_refs ?? raw?.evidenceRefs ?? source?.refs ?? source?.closeout_ref;
  const normalized = Array.isArray(refs) ? uniqueStrings(refs).map((item) => text(item, 240)) : [text(refs, 240)].filter(Boolean);
  return normalized.filter((reference) => !SECRET_PATTERN.test(reference) && !LOCAL_PATH_PATTERN.test(reference));
}

/** @param {unknown} raw @param {number} index @param {string} [reason] */
function reviewItem(raw, index, reason = "needs_user_confirmation") {
  const value = typeof raw === "string" ? { question: raw } : (isRecord(raw) ? raw : {});
  return {
    id: text(value.id || `review-${index + 1}`, 120),
    question: text(value.question || value.title || value.text, 240),
    reason: text(value.reason, 160) || reason,
    sourceRefs: sourceRefs(value, {}),
  };
}

/**
 * Validate and normalize the MARU -> Daybridge boundary.
 *
 * The scheduler receives only `accepted`; review questions and excluded
 * records are deliberately kept out of the executable queue. Fixed clock
 * times are calendar constraints, not quest fields.
 */
/** @param {unknown} packet @param {{sourceDate?: string, targetDate?: string}} [options] */
export function validateQuestPlan(packet, { sourceDate, targetDate } = {}) {
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {Array<{id: string, title: string, reason: string, message: string, sourceRefs: string[]}>} */
  const excluded = [];
  /** @type {ReturnType<typeof reviewItem>[]} */
  const reviewQueue = [];
  /** @type {Array<Record<string, unknown> & {id: string, depends_on: string[]}>} */
  const accepted = [];

  if (!isRecord(packet)) {
    return { valid: false, status: "rejected", source: {}, accepted, reviewQueue, excluded, warnings, errors: ["packet must be a JSON object"] };
  }

  if (packet.artifact_type !== ARTIFACT_TYPE) errors.push(`artifact_type must be ${ARTIFACT_TYPE}`);
  const schemaVersion = text(packet.schema_version || packet.schemaVersion, 20) || "1.0";
  if (!SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) errors.push(`unsupported schema_version: ${schemaVersion}`);

  const source = isRecord(packet.source) ? packet.source : {};
  const packetSourceDate = dateValue(packet.source_date || packet.sourceDate || packet.activity_date || packet.activityDate);
  const packetTargetDate = dateValue(packet.schedule_date || packet.scheduleDate || packet.target_date || packet.targetDate);
  if (sourceDate && packetSourceDate && sourceDate !== packetSourceDate) errors.push("source date does not match the requested source date");
  if (targetDate && packetTargetDate && targetDate !== packetTargetDate) errors.push("schedule date does not match the requested target date");
  if (packetSourceDate && packetTargetDate && packetTargetDate < packetSourceDate) errors.push("schedule date cannot be before source date");

  const packetStatus = text(packet.status, 40) || "ready";
  if (!["ready", "attention", "blocked"].includes(packetStatus)) errors.push(`unsupported packet status: ${packetStatus}`);
  const coverage = normalizeCoverage(source);
  const quality = text(source.quality || source.record_quality, 40) || "unknown";
  const sourceWarnings = uniqueStrings(source.warnings || packet.warnings).map((item) => text(item, 240)).filter(Boolean);
  warnings.push(...sourceWarnings);
  if (coverage === "unavailable") warnings.push("source coverage is unavailable");
  if (packetStatus === "blocked") errors.push("blocked packet cannot create a schedule");

  const rawQuests = list(packet.quests);
  const seenIds = new Set();
  for (let index = 0; index < rawQuests.length; index += 1) {
    const rawValue = rawQuests[index];
    const raw = isRecord(rawValue) ? rawValue : {};
    const rawId = text(raw?.id || raw?.quest_id || raw?.questId, 120);
    const rawTitle = text(raw?.title || raw?.action || raw?.text, 120);
    const reason = (/** @type {string} */ code, message = code) => excluded.push({ id: rawId || `quest-${index + 1}`, title: rawTitle || "제목 없는 작업", reason: code, message, sourceRefs: sourceRefs(raw, source) });
    if (!isRecord(rawValue)) { reason("invalid_quest", "quest must be an object"); continue; }
    if (!rawId) { reason("missing_id", "stable quest id is required"); continue; }
    if (seenIds.has(rawId)) { reason("duplicate_id", "quest ids must be unique in a packet"); continue; }
    seenIds.add(rawId);
    if (!rawTitle) { reason("missing_title", "an action-oriented title is required"); continue; }
    if (SECRET_PATTERN.test(rawTitle) || LOCAL_PATH_PATTERN.test(rawTitle)) { reason("unsafe_text", "secrets and machine-local paths are not allowed"); continue; }
    if (list(FIXED_TIME_FIELDS.map((field) => raw[field])).some((value) => value != null)) { reason("fixed_time_not_allowed", "fixed clock times belong to Calendar busy blocks"); continue; }
    if (raw.actor && raw.actor !== "user") { reason("not_user_action", "only user-executable work enters the schedule"); continue; }
    if (raw.requires_confirmation === true || raw.requiresConfirmation === true) {
      reviewQueue.push(reviewItem({ ...raw, question: raw.question || raw.title }, index));
      continue;
    }

    const kind = text(raw.kind, 40) || "execute";
    if (!QUEST_KINDS.has(kind)) { reason("unsupported_kind", "kind must be execute, review, or decision"); continue; }
    const state = normalizeState(raw.state || raw.status);
    if (!state) { reason("unsupported_state", "state is not recognized"); continue; }
    if (state === "completed") { reason("already_completed", "completed work is retained as history, not scheduled"); continue; }
    if (state === "blocked") { reason("blocked", "blocked work is visible but not executable"); continue; }
    if (text(raw.execution, 40) && !["independent", "sequential"].includes(text(raw.execution, 40))) { reason("unsupported_execution", "execution must be independent or sequential"); continue; }
    const execution = text(raw.execution, 40) || "independent";

    const legacyEstimate = Number(raw.estimate_minutes ?? raw.estimateMinutes);
    const suppliedFocusUnits = raw.focus_units ?? raw.focusUnits;
    if (suppliedFocusUnits != null && !units(suppliedFocusUnits)) { reason("invalid_focus_units", "focus_units must be a positive integer"); continue; }
    const explicitFocusUnits = units(suppliedFocusUnits);
    if (!explicitFocusUnits && schemaVersion !== "1.0") { reason("missing_focus_units", "schema 1.1 quests must declare focus_units"); continue; }
    const focusUnits = explicitFocusUnits || (positiveInteger(legacyEstimate) ? Math.max(1, Math.ceil(legacyEstimate / FOCUS_UNIT_MINUTES)) : 1);
    if (!focusUnits) { reason("missing_focus_units", "focus_units must be a positive integer"); continue; }
    if (!explicitFocusUnits && positiveInteger(legacyEstimate)) warnings.push(`${rawId} uses legacy estimate_minutes; emit focus_units in the next packet`);
    const suppliedRemainingUnits = raw.remaining_units ?? raw.remainingUnits;
    if (suppliedRemainingUnits != null && !units(suppliedRemainingUnits)) { reason("invalid_remaining_units", "remaining_units must be a positive integer"); continue; }
    const legacyRemaining = Number(raw.remaining_minutes ?? raw.remainingMinutes);
    const remainingUnits = units(suppliedRemainingUnits) || (positiveInteger(legacyRemaining) ? Math.max(1, Math.ceil(legacyRemaining / FOCUS_UNIT_MINUTES)) : focusUnits);
    if (remainingUnits > focusUnits) { reason("remaining_exceeds_estimate", "remaining_units cannot exceed focus_units"); continue; }

    const scheduleTitle = text(raw.schedule_title || raw.scheduleTitle, 32);
    if (scheduleTitle && (SECRET_PATTERN.test(scheduleTitle) || LOCAL_PATH_PATTERN.test(scheduleTitle))) { reason("unsafe_schedule_title", "schedule_title contains a secret or local path"); continue; }
    const dependsOn = uniqueStrings(raw.depends_on || raw.dependsOn);
    if (dependsOn.includes(rawId)) { reason("self_dependency", "a quest cannot depend on itself"); continue; }
    const normalized = {
      ...raw,
      id: rawId,
      title: rawTitle,
      schedule_title: scheduleTitle || undefined,
      actor: "user",
      kind,
      execution,
      state,
      status: state,
      priority: typeof raw.priority === "string" && PRIORITIES.has(raw.priority) ? raw.priority : "should",
      depends_on: dependsOn,
      focus_units: focusUnits,
      remaining_units: remainingUnits,
      estimate_minutes: focusUnits * FOCUS_UNIT_MINUTES,
      remaining_minutes: remainingUnits * FOCUS_UNIT_MINUTES,
      source_refs: sourceRefs(raw, source),
    };
    if (schemaVersion !== "1.0" && !text(raw.first_action || raw.firstAction || raw.current_action || raw.currentAction, 240)) warnings.push(`${rawId} has no first_action; title will be used as the first action`);
    if (execution === "independent" && list(raw.steps).length > 1) warnings.push(`${rawId} has multiple steps but is independent; only the first executable step should be shown`);
    if (execution === "sequential" && list(raw.steps).length > 1 && list(raw.steps).some((step) => !text(typeof step === "string" ? step : isRecord(step) ? step.label || step.title || step.action : undefined, 180))) { reason("invalid_step", "every sequential step needs a label"); continue; }
    accepted.push(normalized);
  }

  const reviewQuestions = list(packet.review_queue || packet.reviewQueue);
  reviewQuestions.forEach((item, index) => { const normalized = reviewItem(item, index); if (normalized.question) reviewQueue.push(normalized); });
  list(packet.confirmation_questions || packet.confirmationQuestions).forEach((item, index) => { const normalized = reviewItem(item, reviewQueue.length + index); if (normalized.question) reviewQueue.push(normalized); });
  const unresolved = accepted.flatMap((quest) => quest.depends_on.filter((dependency) => !seenIds.has(dependency)));
  if (unresolved.length) warnings.push(`unresolved dependencies: ${[...new Set(unresolved)].join(", ")}`);
  const valid = errors.length === 0;
  const status = !valid ? "rejected" : (warnings.length || excluded.length || reviewQueue.length ? "attention" : "accepted");
  return {
    valid,
    status,
    source: {
      sourceDate: packetSourceDate || sourceDate || null,
      targetDate: packetTargetDate || targetDate || null,
      coverage,
      quality,
      warnings: sourceWarnings,
      refs: sourceRefs({}, source),
    },
    accepted,
    reviewQueue,
    excluded,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
  };
}
