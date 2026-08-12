import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACTION_WORDS = /check|verify|review|write|send|record|run|decide|prepare|update|fix|implement|confirm|draft|publish|inspect|정리|확인|검토|작성|기록|결정|준비|수정|구현|발행|점검/i;
const COMPLETED_WORDS = /finished|done|completed|완료|끝냈|처리했/i;
const SECRET_WORDS = /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret|cookie|session[_ -]?token|private[_ -]?key)\s*[:=]\s*[^\s]+/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g;
const LOCAL_PATH = /\b[A-Z]:\\[^\s|]+/gi;

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
  return { plan: join(system, `${sourceDate}_daybridge_quest_plan.json`), briefing: join(system, `${sourceDate}_briefing_synthesis.json`), unified: join(system, `${sourceDate}_unified.json`) };
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
  return input.map((step, index) => {
    const item = typeof step === "string" ? { label: step } : step || {};
    return { id: String(item.id || `${id}-step-${index + 1}`), label: clean(item.label || item.title || item.action, 180), completed: Boolean(item.completed), order: Number.isFinite(item.order) ? item.order : index + 1, dependsOn: Array.isArray(item.depends_on || item.dependsOn) ? [...(item.depends_on || item.dependsOn)] : [] };
  }).filter((step) => step.label);
}
function candidateToQuest(raw, context, index) {
  const title = titleFor(raw.title || raw.action || raw.text || raw.next_action || raw.nextAction);
  if (!title || COMPLETED_WORDS.test(title)) return null;
  const explicit = raw.actor || raw.kind || raw.mission_id || raw.missionId || raw.depends_on || raw.dependsOn;
  if (!explicit && typeof raw === "string" && !ACTION_WORDS.test(title)) return null;
  const project = projectFrom(raw.project || context.project || raw.source_ref || raw.evidence);
  const id = String(raw.id || raw.quest_id || raw.questId || stableId("quest", inferMission(project, raw), title));
  const steps = stepObjects(raw, id);
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
    firstStep: clean(raw.first_step || raw.firstStep || steps[0]?.label || title, 240),
    currentAction: clean(raw.current_action || raw.currentAction || steps.find((step) => !step.completed)?.label || steps[0]?.label || title, 240),
    doneWhen: clean(raw.done_when || raw.doneWhen || "The observable result is recorded.", 240),
    estimateMinutes: Math.max(5, Math.min(90, Number(raw.estimate_minutes || raw.estimateMinutes) || (steps.length > 1 ? steps.length * 15 : 15))),
    progress: { completed: steps.filter((step) => step.completed).length, total: steps.length },
    carryoverCount: Number(raw.carryover_count || raw.carryoverCount) || 0,
    steps,
    sourceLabel: clean(raw.source_label || raw.sourceLabel || context.sourceLabel || "AIHUB Quest Extractor", 100),
    sourcePath: clean(raw.source_path || raw.sourcePath || context.sourcePath || safeRef("aihub", context.sourceDate || "unknown", "closeout"), 240),
    sourceRefs: sourceRefs(raw, context.sourceRefs),
    reports: Array.isArray(raw.reports) ? raw.reports : [],
  };
}
function planCandidates(plan, sourceDate) { return (Array.isArray(plan?.quests) ? plan.quests : []).map((raw, index) => candidateToQuest(raw, { sourceDate, sourceLabel: "AIHUB Quest Plan", sourcePath: safeRef("aihub", sourceDate, "quest-plan") }, index)).filter(Boolean); }
function closeoutCandidates(packet, sourceDate) {
  const values = [
    ...(Array.isArray(packet?.tomorrow_first_steps) ? packet.tomorrow_first_steps : []),
    ...(Array.isArray(packet?.immediate_actions) ? packet.immediate_actions : []),
    ...(Array.isArray(packet?.open_items) ? packet.open_items : []),
    ...(Array.isArray(packet?.confirmation_questions) ? packet.confirmation_questions.map((title) => ({ title, kind: "decision" })) : []),
  ];
  return values.map((raw, index) => candidateToQuest(raw, { sourceDate, sourceLabel: "AIHUB closeout (legacy)", sourcePath: safeRef("aihub", sourceDate, "briefing"), priority: index < 2 ? "must" : "should" }, index)).filter(Boolean);
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
  const warnings = []; const sourceInputs = []; let sourceCoverage = "stale"; let sourceQuality = "unknown"; let quests = [];
  const root = options.aihubRoot || profileRoot(); const sourcePaths = root ? pathsFor(root, sourceDate) : null;
  if (options.questPlan && existsSync(options.questPlan)) { const plan = readJson(options.questPlan); quests = planCandidates(plan, sourceDate); sourceInputs.push(safeRef("aihub", sourceDate, "quest-plan")); sourceCoverage = plan?.status === "ready" || plan?.artifact_type === "daybridge_quest_plan" ? "connected" : "attention"; sourceQuality = plan?.source?.quality || "unknown"; }
  else if (source !== "diary" && sourcePaths?.plan && existsSync(sourcePaths.plan)) { const plan = readJson(sourcePaths.plan); quests = planCandidates(plan, sourceDate); sourceInputs.push(safeRef("aihub", sourceDate, "quest-plan")); sourceCoverage = "connected"; sourceQuality = plan?.source?.quality || "unknown"; }
  else if (source !== "diary" && sourcePaths?.briefing && existsSync(sourcePaths.briefing)) { const packet = readJson(sourcePaths.briefing); if (sourceDate > kstToday()) { warnings.push("Closeout packet has a future activity date."); } else { quests = closeoutCandidates(packet, sourceDate); } sourceInputs.push(safeRef("aihub", sourceDate, "briefing")); sourceCoverage = "attention"; sourceQuality = packet?.coverage?.record_quality || "unknown"; warnings.push("Quest Plan was unavailable; compiled legacy closeout candidates."); }
  else if (Array.isArray(options.input) && options.input.length) { for (const input of options.input) { if (!existsSync(input)) continue; const json = input.toLowerCase().endsWith(".json") ? readJson(input) : null; quests.push(...(json?.artifact_type === "daybridge_quest_plan" ? planCandidates(json, sourceDate) : json?.artifact_type === "aihub_briefing_synthesis" ? closeoutCandidates(json, sourceDate) : parseMarkdown(readFileSync(input, "utf8"), sourceDate))); sourceInputs.push(safeRef("input", sourceDate)); } sourceCoverage = quests.length ? "connected" : "attention"; }
  else { warnings.push(root ? "No Quest Plan or closeout packet was found." : "AIHUB machine profile could not be resolved."); sourceCoverage = "attention"; }
  const deduped = [...new Map(quests.map((quest) => [quest.id, quest])).values()]; const kept = preserveState(deduped, outputPath, targetDate);
  const board = { schemaVersion: 2, activityDate: targetDate, sourceDate, sourceInputs, title: `${targetDate} quest board`, generatedAt: new Date().toISOString(), sourceCoverage, sourceQuality, sourceWarnings: warnings, missions: makeMissions(kept), quests: kept };
  if (options.output || !options.print) atomicWriteJson(outputPath, board); if (options.print || !options.output) console.log(JSON.stringify(board, null, 2)); else console.log(`Compiled ${board.quests.length} quests from ${sourceInputs.length} plan packet(s): ${outputPath}`); return board;
}
function selfTest() { const plan = { artifact_type: "daybridge_quest_plan", source: { quality: "aligned" }, quests: [{ id: "q-a", mission_id: "m-a", title: "Check source", steps: [{ id: "s-a", label: "Open source" }, { id: "s-b", label: "Record result", depends_on: ["s-a"] }], execution: "sequential" }, { id: "q-b", title: "Write note", actor: "automation", kind: "monitor" }] }; const quests = planCandidates(plan, "2026-08-11"); if (quests.length !== 2 || quests[0].steps.length !== 2 || quests[0].execution !== "sequential") throw new Error("Compiler self-test failed"); console.log("compile-quests self-test passed"); }
const directExecution = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url); if (directExecution) { const args = parseArgs(process.argv.slice(2)); if (args.selfTest) selfTest(); else compile(args); }
