import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateQuestPlan, FOCUS_UNIT_MINUTES } from "../src/schedule/input-contract.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACTION_WORDS = /check|verify|review|write|send|record|run|decide|prepare|update|fix|implement|confirm|draft|publish|inspect|정리|확인|검토|작성|기록|결정|준비|수정|구현|발행|점검/i;
const COMPLETED_WORDS = /finished|done|completed|완료|끝냈|처리했/i;
const SECRET_WORDS = /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret|cookie|session[_ -]?token|private[_ -]?key)\s*[:=]\s*[^\s]+/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g;
const LOCAL_PATH = /(?:\b[A-Z]:[\\/]|<drive>:[\\/]|\\\\)[^\s|]+/gi;
const UNSAFE_CARD_TEXT = /\[local path\]|(?:\b[A-Z]:[\\/]|<drive>:[\\/]|\\\\)[^\s|]+/i;

function kstToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()); }
function isDate(value) { return DATE.test(value || ""); }
export function shiftDate(date, amount) { const value = new Date(`${date}T12:00:00+09:00`); value.setDate(value.getDate() + amount); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(value); }
export function nextBusinessDay(date) { let candidate = shiftDate(date, 1); while ([0, 6].includes(new Date(`${candidate}T12:00:00+09:00`).getUTCDay())) candidate = shiftDate(candidate, 1); return candidate; }
function previousBusinessDay(date) { let candidate = shiftDate(date, -1); while ([0, 6].includes(new Date(`${candidate}T12:00:00+09:00`).getUTCDay())) candidate = shiftDate(candidate, -1); return candidate; }
function clean(value, limit = 360) { return String(value || "").replace(/```[^`]*```/g, "").replace(/!?\[[^\]]*\]\([^)]*\)/g, "").replace(EMAIL, "[email removed]").replace(PHONE, "[phone removed]").replace(SECRET_WORDS, "[sensitive value removed]").replace(LOCAL_PATH, "[local path]").replace(/\s+/g, " ").replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "").trim().slice(0, limit).trim(); }
function readJson(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function atomicWriteJson(path, value) { mkdirSync(dirname(path), { recursive: true }); const temporary = join(dirname(path), `.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`); writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); renameSync(temporary, path); }
function safeRef(kind, date, suffix = "") { return `${kind}://${date}${suffix ? `/${suffix}` : ""}`; }
function normaliseKey(value) { return clean(value, 180).toLowerCase().replace(/[^a-z0-9가-힣]+/gi, "-").replace(/^-|-$/g, ""); }
function stableId(prefix, ...parts) { return `${prefix}-${createHash("sha256").update(parts.map(normaliseKey).join("|")).digest("hex").slice(0, 12)}`; }
export function titleFor(action) { const text = clean(action, 140); const card = text.match(/(\d+)개?\s*카드.*원문.*확인/i); return card ? `${card[1]}개 카드 원문 근거 확인하기` : text || "Untitled quest"; }

function profileRoot() {
  const appData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const profile = readJson(join(appData, "AIHUB", "environment.json"));
  return profile && typeof profile.aihub_root === "string" ? profile.aihub_root : null;
}
function pathsFor(root, sourceDate) {
  const system = join(root, "04_Operations_And_Automation", "Memory_System", "reports", "daily", "_system");
  return { plan: join(system, `${sourceDate}_daybridge_quest_plan.json`), briefing: join(system, `${sourceDate}_briefing_synthesis.json`), unified: join(system, `${sourceDate}_unified.json`), handoff: join(system, "latest_daybridge_handoff.json") };
}
function boundaryMetadata(sourcePaths, sourceDate, targetDate) {
  const warnings = []; const excluded = []; const metadata = {};
  const unified = sourcePaths?.unified ? readJson(sourcePaths.unified) : null;
  const conversation = unified?.coverage?.conversation;
  if (conversation && (conversation.today_scope === "unavailable" || conversation.all_history_scope === "unavailable")) {
    warnings.push("Conversation coverage is unavailable for today and all-history scope.");
    metadata.conversationCoverage = { todayScope: conversation.today_scope, allHistoryScope: conversation.all_history_scope };
  }
  if (unified?.session_archive?.status === "blocked") warnings.push("Session archive is blocked; full session coverage is not confirmed.");
  if (unified?.session_quiescence?.status === "blocked") warnings.push("Session shutdown is blocked; full session coverage is not confirmed.");
  const handoff = sourcePaths?.handoff ? readJson(sourcePaths.handoff) : null;
  const handoffText = handoff ? JSON.stringify(handoff) : "";
  const handoffDate = handoff?.activity_date || handoff?.activityDate;
  if (handoff && ((handoffDate && handoffDate > targetDate) || /2099[-/]\d{2}[-/]\d{2}|test complete report|synthetic fixture/i.test(handoffText))) {
    warnings.push("Future or synthetic latest handoff was excluded from the current board.");
    excluded.push({ title: clean(handoff.report || handoff.event || "Synthetic or future Daybridge handoff", 260), reason: "future or synthetic handoff is not a source for the current board", sourceRefs: [safeRef("aihub", sourceDate, "latest-daybridge-handoff")] });
  }
  return { warnings, excluded, metadata };
}
function projectFrom(value) {
  const text = clean(value, 100);
  if (/TCG_Trade_Web|TCG Trade Web/i.test(text)) return "TCG Trade Web";
  if (/Daybridge/i.test(text)) return "Daybridge";
  if (/AI_HUB|Skills_And_Prompts|automation|memory/i.test(text)) return "AIHUB operations";
  return text || "Personal work";
}
function inferMission(project, raw) { return clean(raw.mission_id || raw.missionId || stableId("mission", project, raw.mission || project), 120); }
function inferPriority(raw, fallback = "should") { return ["must", "should", "could"].includes(raw.priority) ? raw.priority : fallback; }
function inferExecution(raw) { return raw.execution === "sequential" || raw.execution?.mode === "sequential" ? "sequential" : "independent"; }
function inferState(raw) { const state = raw.state || raw.status; if (state === "not_started") return "ready"; if (state === "paused") return "deferred"; return ["ready", "in_progress", "deferred", "blocked", "completed"].includes(state) ? state : "ready"; }
function sourceRefs(raw, fallback) { const refs = raw.source_refs || raw.sourceRefs || raw.evidence_refs || raw.evidenceRefs || raw.evidence || fallback; return Array.isArray(refs) ? refs.map((item) => clean(item, 240)).filter(Boolean) : [clean(refs, 240)].filter(Boolean); }
function stepObjects(raw, id) {
  const input = Array.isArray(raw.steps) ? raw.steps : [raw.first_step || raw.firstStep || raw.next_action || raw.nextAction || raw.title || raw.action];
  const hasStepDependencies = input.some((step) => step && typeof step === "object" && Array.isArray(step.depends_on || step.dependsOn) && (step.depends_on || step.dependsOn).length > 0);
  const keepBreakdown = inferExecution(raw) === "sequential" || hasStepDependencies || raw.split_steps === true;
  const selected = keepBreakdown ? input : input.slice(0, 1);
  const steps = selected.map((step, index) => {
    const item = typeof step === "string" ? { label: step } : step || {};
    return { id: String(item.id || `${id}-step-${index + 1}`), label: clean(item.label || item.title || item.action, 180), completed: Boolean(item.completed), order: Number.isFinite(item.order) ? item.order : index + 1, dependsOn: Array.isArray(item.depends_on || item.dependsOn) ? [...(item.depends_on || item.dependsOn)] : [] };
  }).filter((step) => step.label);
  if (keepBreakdown && inferExecution(raw) === "sequential") {
    steps.forEach((step, index) => { if (index > 0 && !step.dependsOn.length) step.dependsOn = [steps[index - 1].id]; });
  }
  return steps;
}
function candidateToQuest(raw, context, index) {
  const title = titleFor(raw.title || raw.action || raw.text || raw.next_action || raw.nextAction);
  if (!title || COMPLETED_WORDS.test(title)) return null;
  const explicit = raw.actor || raw.kind || raw.mission_id || raw.missionId || raw.depends_on || raw.dependsOn;
  if (!explicit && typeof raw === "string" && !ACTION_WORDS.test(title)) return null;
  const project = projectFrom(raw.project || context.project || raw.source_ref || raw.evidence);
  const id = String(raw.id || raw.quest_id || raw.questId || stableId("quest", inferMission(project, raw), title));
  const steps = stepObjects(raw, id);
  const firstStep = clean(raw.first_step || raw.firstStep || steps[0]?.label || title, 240);
  const currentAction = clean(raw.current_action || raw.currentAction || steps.find((step) => !step.completed)?.label || steps[0]?.label || title, 240);
  if ([title, firstStep, currentAction, ...steps.map((step) => step.label)].some((value) => UNSAFE_CARD_TEXT.test(value))) return null;
  const legacyEstimate = Number(raw.estimate_minutes || raw.estimateMinutes);
  const focusUnits = Number.isInteger(Number(raw.focus_units || raw.focusUnits)) && Number(raw.focus_units || raw.focusUnits) > 0
    ? Number(raw.focus_units || raw.focusUnits)
    : Math.max(1, Math.ceil((legacyEstimate || (steps.length > 1 ? steps.length * 15 : 15)) / FOCUS_UNIT_MINUTES));
  const remainingUnits = Number.isInteger(Number(raw.remaining_units || raw.remainingUnits)) && Number(raw.remaining_units || raw.remainingUnits) > 0
    ? Math.min(focusUnits, Number(raw.remaining_units || raw.remainingUnits))
    : focusUnits;
  return {
    id,
    missionId: inferMission(project, raw),
    title,
    project,
    priority: inferPriority(raw, context.priority || "should"),
    kind: ["execute", "review", "decision"].includes(raw.kind) ? raw.kind : context.kind || "execute",
    execution: inferExecution(raw),
    dependsOn: Array.isArray(raw.depends_on || raw.dependsOn) ? [...(raw.depends_on || raw.dependsOn)] : [],
    state: inferState(raw),
    status: inferState(raw),
    summary: clean(raw.summary || raw.description || title, 260),
    firstStep,
    currentAction,
    doneWhen: clean(raw.done_when || raw.doneWhen || "The observable result is recorded.", 240),
    scheduleTitle: clean(raw.schedule_title || raw.scheduleTitle, 32) || undefined,
    focusUnits,
    remainingUnits,
    estimateMinutes: focusUnits * FOCUS_UNIT_MINUTES,
    remainingMinutes: remainingUnits * FOCUS_UNIT_MINUTES,
    progress: { completed: steps.filter((step) => step.completed).length, total: steps.length },
    carryoverCount: Number(raw.carryover_count || raw.carryoverCount) || 0,
    steps,
    sourceLabel: clean(raw.source_label || raw.sourceLabel || context.sourceLabel || "AIHUB Quest Extractor", 100),
    sourcePath: clean(raw.source_path || raw.sourcePath || context.sourcePath || safeRef("aihub", context.sourceDate || "unknown", "closeout"), 240),
    sourceRefs: sourceRefs(raw, context.sourceRefs),
    sourceField: raw.source_field || raw.sourceField || context.sourceField,
    reports: Array.isArray(raw.reports) ? raw.reports : [],
  };
}
function planCandidates(plan, sourceDate, targetDate, validation = validateQuestPlan(plan, { sourceDate, targetDate })) {
  if (!validation.valid) return [];
  return validation.accepted.map((raw, index) => candidateToQuest(raw, { sourceDate, sourceLabel: "AIHUB Quest Plan", sourcePath: safeRef("aihub", sourceDate, "quest-plan") }, index)).filter(Boolean);
}
function closeoutCandidates(packet, sourceDate) {
  const values = [
    ...(Array.isArray(packet?.tomorrow_first_steps) ? packet.tomorrow_first_steps : []),
    ...(Array.isArray(packet?.immediate_actions) ? packet.immediate_actions : []),
    ...(Array.isArray(packet?.open_items) ? packet.open_items : []),
  ];
  return values.map((raw, index) => candidateToQuest(raw, { sourceDate, sourceLabel: "AIHUB closeout (legacy)", sourcePath: safeRef("aihub", sourceDate, "briefing"), priority: index < 2 ? "must" : "should" }, index)).filter(Boolean);
}
function closeoutReviewQueue(packet, sourceDate) {
  const values = [
    ...(Array.isArray(packet?.review_queue) ? packet.review_queue : []),
    ...(Array.isArray(packet?.reviewQueue) ? packet.reviewQueue : []),
    ...(Array.isArray(packet?.confirmation_questions) ? packet.confirmation_questions : []),
  ];
  return values.map((item, index) => {
    const title = clean(typeof item === "string" ? item : item?.question || item?.title || item?.text, 240);
    if (!title) return null;
    return { id: String(item?.id || `review-${index + 1}`), question: title, reason: clean(item?.reason || "needs_user_confirmation", 160), sourceRefs: [safeRef("aihub", sourceDate, "briefing")] };
  }).filter(Boolean);
}
function parseMarkdown(text, sourceDate) { return String(text || "").split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*+] |\d+[.)] )/, "").trim()).filter((line) => line && ACTION_WORDS.test(line) && !COMPLETED_WORDS.test(line)).map((title) => candidateToQuest({ title }, { sourceDate, sourceLabel: "input", sourcePath: safeRef("input", sourceDate) }, 0)).filter(Boolean); }
function preserveState(quests, outputPath, targetDate) {
  const existing = readJson(outputPath); const previous = new Map(Array.isArray(existing?.quests) ? existing.quests.map((quest) => [quest.id, quest]) : []);
  return quests.map((quest) => {
    const old = previous.get(quest.id); if (!old) return quest;
    const stepsById = new Map(Array.isArray(old.steps) ? old.steps.map((step) => [step.id, step]) : []);
    const steps = quest.steps.map((step) => ({ ...step, completed: Boolean(stepsById.get(step.id)?.completed) }));
    const completed = steps.filter((step) => step.completed).length; const oldState = old.state || old.status;
    const state = oldState === "completed" ? "completed" : (oldState === "paused" ? "deferred" : oldState || quest.state);
    return { ...quest, state, status: state, steps, progress: { completed, total: steps.length }, carryoverCount: targetDate !== existing.activityDate && state !== "completed" ? (Number(old.carryoverCount) || 0) + 1 : Number(old.carryoverCount) || quest.carryoverCount, reports: Array.isArray(old.reports) ? old.reports : quest.reports, updatedAt: old.updatedAt };
  });
}
function makeMissions(quests) {
  const groups = new Map(); for (const quest of quests) { const group = groups.get(quest.missionId) || { id: quest.missionId, title: quest.project, project: quest.project, completed: 0, total: 0 }; group.completed += quest.progress.completed; group.total += quest.progress.total; groups.set(quest.missionId, group); }
  return [...groups.values()].map(({ completed, total, ...mission }) => ({ ...mission, progress: { completed, total } }));
}
function resolveDates(options) { const targetDate = isDate(options.targetDate) ? options.targetDate : kstToday(); const sourceDate = isDate(options.sourceDate) ? options.sourceDate : previousBusinessDay(targetDate); return { targetDate, sourceDate }; }
function parseArgs(argv) { const args = { source: "auto", input: [] }; for (let i = 0; i < argv.length; i += 1) { const value = argv[i]; if (value === "--input") args.input.push(argv[++i]); else if (value === "--target-date") args.targetDate = argv[++i]; else if (value === "--source-date") args.sourceDate = argv[++i]; else if (value === "--source") args.source = argv[++i]; else if (value === "--quest-plan") args.questPlan = argv[++i]; else if (value === "--output") args.output = argv[++i]; else if (value === "--print") args.print = true; else if (value === "--self-test") args.selfTest = true; } return args; }

export function compile(options = {}) {
  const { targetDate, sourceDate } = resolveDates(options);
  const source = options.source || "auto";
  const outputPath = resolve(options.output || join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Daybridge", "boards", `${targetDate}.json`));
  const warnings = []; const sourceInputs = []; const excluded = []; const reviewQueue = []; let sourceCoverage = "stale"; let sourceQuality = "unknown"; let quests = []; let plan = null;
  const root = options.aihubRoot || profileRoot(); const sourcePaths = root && !options.questPlan ? pathsFor(root, sourceDate) : null;
  const boundary = boundaryMetadata(sourcePaths, sourceDate, targetDate); warnings.push(...boundary.warnings); excluded.push(...boundary.excluded);
  const sourceIsFuture = sourceDate > targetDate;
  if (sourceIsFuture) warnings.push("Source packet has a future activity date relative to the current board.");
  if (options.questPlan && existsSync(options.questPlan)) { plan = readJson(options.questPlan); const validation = validateQuestPlan(plan, { sourceDate, targetDate }); if (!sourceIsFuture) quests = planCandidates(plan, sourceDate, targetDate, validation); sourceInputs.push(safeRef("aihub", sourceDate, "quest-plan")); sourceCoverage = validation.valid && validation.source.coverage === "complete" ? "connected" : "attention"; sourceQuality = validation.source.quality; warnings.push(...validation.warnings, ...validation.errors); excluded.push(...validation.excluded); reviewQueue.push(...validation.reviewQueue); }
  else if (source !== "diary" && sourcePaths?.plan && existsSync(sourcePaths.plan)) { plan = readJson(sourcePaths.plan); const validation = validateQuestPlan(plan, { sourceDate, targetDate }); if (!sourceIsFuture) quests = planCandidates(plan, sourceDate, targetDate, validation); sourceInputs.push(safeRef("aihub", sourceDate, "quest-plan")); sourceCoverage = validation.valid && validation.source.coverage === "complete" ? "connected" : "attention"; sourceQuality = validation.source.quality; warnings.push(...validation.warnings, ...validation.errors); excluded.push(...validation.excluded); reviewQueue.push(...validation.reviewQueue); }
  else if (source !== "diary" && sourcePaths?.briefing && existsSync(sourcePaths.briefing)) { const packet = readJson(sourcePaths.briefing); if (!sourceIsFuture) quests = closeoutCandidates(packet, sourceDate); sourceInputs.push(safeRef("aihub", sourceDate, "briefing")); sourceCoverage = "attention"; sourceQuality = packet?.coverage?.record_quality || "unknown"; warnings.push("Quest Plan was unavailable; compiled legacy closeout candidates."); reviewQueue.push(...closeoutReviewQueue(packet, sourceDate)); }
  else if (Array.isArray(options.input) && options.input.length) { for (const input of options.input) { if (!existsSync(input)) continue; const json = input.toLowerCase().endsWith(".json") ? readJson(input) : null; if (json?.artifact_type === "daybridge_quest_plan") { const validation = validateQuestPlan(json, { sourceDate, targetDate }); quests.push(...planCandidates(json, sourceDate, targetDate, validation)); warnings.push(...validation.warnings, ...validation.errors); excluded.push(...validation.excluded); reviewQueue.push(...validation.reviewQueue); } else if (json?.artifact_type === "aihub_briefing_synthesis") { quests.push(...closeoutCandidates(json, sourceDate)); reviewQueue.push(...closeoutReviewQueue(json, sourceDate)); } else quests.push(...parseMarkdown(readFileSync(input, "utf8"), sourceDate)); sourceInputs.push(safeRef("input", sourceDate)); } sourceCoverage = quests.length ? "connected" : "attention"; }
  else { warnings.push(root ? "No Quest Plan or closeout packet was found." : "AIHUB machine profile could not be resolved."); sourceCoverage = "attention"; }
  if (plan?.source?.warnings) warnings.push(...plan.source.warnings); if (Array.isArray(plan?.warnings)) warnings.push(...plan.warnings); if (Array.isArray(plan?.excluded)) excluded.push(...plan.excluded);
  const uniqueWarnings = [...new Set(warnings.filter(Boolean))]; if (uniqueWarnings.length || plan?.source?.coverage === "attention") sourceCoverage = "attention";
  const deduped = [...new Map(quests.map((quest) => [quest.id, quest])).values()]; const kept = preserveState(deduped, outputPath, targetDate);
  const uniqueExcluded = [...new Map(excluded.map((item) => [`${clean(item.title, 260).toLowerCase()}|${clean(item.reason, 260).toLowerCase()}`, item])).values()];
  const uniqueReviewQueue = [...new Map(reviewQueue.map((item) => [item.id, item])).values()];
  const board = { schemaVersion: 2, activityDate: targetDate, sourceDate, sourceInputs, title: `${targetDate} quest board`, generatedAt: new Date().toISOString(), sourceCoverage, sourceQuality, sourceWarnings: uniqueWarnings, sourceMetadata: { ...boundary.metadata, ...(plan?.source || {}) }, excluded: uniqueExcluded, reviewQueue: uniqueReviewQueue, missions: makeMissions(kept), quests: kept };
  if (options.output || !options.print) atomicWriteJson(outputPath, board); if (options.print || !options.output) console.log(JSON.stringify(board, null, 2)); else console.log(`Compiled ${board.quests.length} quests from ${sourceInputs.length} plan packet(s): ${outputPath}`); return board;
}
function selfTest() { const plan = { artifact_type: "daybridge_quest_plan", source: { quality: "aligned" }, quests: [{ id: "q-a", mission_id: "m-a", title: "Check source", actor: "user", kind: "review", steps: [{ id: "s-a", label: "Open source" }, { id: "s-b", label: "Record result", depends_on: ["s-a"] }], execution: "sequential" }, { id: "q-b", title: "Write note", actor: "user", kind: "execute" }] }; const quests = planCandidates(plan, "2026-08-11"); if (quests.length !== 2 || quests[0].steps.length !== 2 || quests[0].execution !== "sequential") throw new Error("Compiler self-test failed"); console.log("compile-quests self-test passed"); }
const directExecution = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url); if (directExecution) { const args = parseArgs(process.argv.slice(2)); if (args.selfTest) selfTest(); else compile(args); }
