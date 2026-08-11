import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ACTION_WORDS = /확인|검토|대조|정비|적용|작성|회신|기록|실행|진행|결정|추가|수정|정리|검증|준비|연락|공유|설정|열기|시작|보강|학습|정하|한다|해야|할 필요|review|check|verify|draft|write|send|record|run|decide|prepare|update/i;
const COMPLETED_WORDS = /완료(?:됨|했다)?|구현(?:됨|했다)?|처리했다|끝냈|finished|done|completed/i;
const META_WORDS = /^(?:목표|한 일|결과|검증|안전|상태|결정|근거|evidence|source|summary|목적)\s*[:：]/i;
const SECTION_WORDS = /다음 행동|내일.*행동|남은 작업|권장 다음 행동|recommended next action|next action|확인 필요|미완료|막힘|todo|할 일/i;
const SECRET_WORDS = /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret|cookie|session[_ -]?token|private[_ -]?key)\s*[:=]\s*[^\s]+/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g;
const LOCAL_PATH = /\b[A-Z]:\\[^\s|]+/gi;

function kstToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()); }
function shiftDate(date, amount) { const value = new Date(`${date}T12:00:00+09:00`); value.setDate(value.getDate() + amount); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(value); }
function clean(value, limit = 360) {
  return String(value || "").replace(/```[^`]*```/g, "").replace(/!?(\[[^\]]*\])\([^)]*\)/g, "$1").replace(EMAIL, "[email removed]").replace(PHONE, "[phone removed]").replace(SECRET_WORDS, "[sensitive value removed]").replace(LOCAL_PATH, "[local path]").replace(/\s+/g, " ").replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "").trim().slice(0, limit).trim();
}
function safeSourcePath(kind, date, suffix = "") { return `${kind}://${date}${suffix ? `/${suffix}` : ""}`; }
function readJson(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function profileRoot() {
  const appData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"); const profile = readJson(join(appData, "AIHUB", "environment.json"));
  return profile && typeof profile.aihub_root === "string" ? profile.aihub_root : null;
}
function defaultSources(sourceDate) {
  const diaryDir = join(homedir(), "Desktop", "KTH", "업무자료", "AI_Work_Diary", "daily"); const aihub = profileRoot();
  const diary = { path: join(diaryDir, `${sourceDate}_ai_work_diary.md`), label: "KTH 업무일기", safePath: safeSourcePath("diary", sourceDate) };
  if (existsSync(diary.path)) return [diary];
  return [diary, ...(aihub ? [
      { path: join(aihub, "04_Operations_And_Automation", "Memory_System", "reports", "daily", `${sourceDate}.md`), label: "AIHUB 일일 보고", safePath: safeSourcePath("aihub", sourceDate, "report") },
      { path: join(aihub, "04_Operations_And_Automation", "Memory_System", "reports", "daily", "_system", `${sourceDate}_briefing_synthesis.json`), label: "AIHUB 브리핑", safePath: safeSourcePath("aihub", sourceDate, "briefing") },
    ] : [])];
}
function parseJsonCandidates(value, context, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) { for (const item of value) parseJsonCandidates(item, context, output); return output; }
  const text = [value.title, value.label, value.action, value.next_action, value.nextAction, value.first_step, value.firstStep, value.text].find((item) => typeof item === "string" && item.trim());
  if (text) {
    const label = clean(value.label || context.label || "다음 행동", 100); const action = clean(text);
    if (action && ACTION_WORDS.test(action) && !COMPLETED_WORDS.test(action)) output.push({ text: action, label, firstStep: clean(value.first_step || value.firstStep || action, 240), doneWhen: clean(value.done_when || value.doneWhen || "결과와 근거를 기록하면 완료", 240), category: /내일|tomorrow|immediate|priority/i.test(label) ? "main" : "side", sourceLabel: context.label, sourcePath: context.safePath });
  }
  for (const [key, item] of Object.entries(value)) {
    if (["title", "label", "action", "next_action", "nextAction", "first_step", "firstStep", "done_when", "doneWhen", "text"].includes(key)) continue;
    if (/tomorrow_first_steps|immediate_actions|open_items|confirmation_questions|next_actions|actions|items/i.test(key)) parseJsonCandidates(item, { ...context, label: key }, output);
  }
  return output;
}
function parseMarkdown(text, context) {
  const lines = String(text || "").split(/\r?\n/); const candidates = []; let section = ""; let pendingFirst = ""; let pendingDone = "";
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    if (/^#{1,6}\s*/.test(line)) { section = clean(line.replace(/^#{1,6}\s*/, ""), 120); pendingFirst = ""; pendingDone = ""; continue; }
    const field = line.match(/^(?:첫 행동|첫 단계|first step)\s*[:：]\s*(.+)$/i); if (field) { pendingFirst = clean(field[1], 240); continue; }
    const done = line.match(/^(?:완료 기준|완료 조건|done when|completion)\s*[:：]\s*(.+)$/i); if (done) { pendingDone = clean(done[1], 240); continue; }
    const inline = line.match(/^(?:다음 행동|요청\/다음 행동|next action|next_action|내일 첫 행동|남은 작업|todo)\s*[:：]\s*(.+)$/i); const bullet = line.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/); const bulletField = bullet?.[1]?.match(/^(?:다음 행동|요청\/다음 행동|next action|next_action|내일 첫 행동|남은 작업|todo)\s*[:：]\s*(.+)$/i); const textValue = inline?.[1] || bulletField?.[1] || bullet?.[1];
    if (!textValue || META_WORDS.test(line)) continue;
    const action = clean(textValue); const isActionSection = SECTION_WORDS.test(section) || Boolean(inline) || Boolean(bulletField);
    if (!isActionSection || !action || COMPLETED_WORDS.test(action) || !ACTION_WORDS.test(action)) continue;
    const statusLabel = /막힘|blocked/i.test(section) ? "막힘" : /보류|paused/i.test(section) ? "보류" : /확인 필요|needs confirmation/i.test(section) ? "확인 필요" : section || "다음 행동";
    candidates.push({ text: action, label: clean(statusLabel, 100), firstStep: pendingFirst || action, doneWhen: pendingDone || "결과와 근거를 기록하면 완료", category: /내일|tomorrow|다음 행동|next action|immediate/i.test(section) ? "main" : "side", sourceLabel: context.label, sourcePath: context.safePath });
  }
  return candidates;
}
function titleFor(action) {
  let title = clean(action, 120).replace(/^(?:내일|오늘)\s+/, "").replace(/^사용자가\s+/, "").replace(/\s*(?:해야 한다|해야 함|한다|할 것|하기로 한다)\.?$/i, "").replace(/[.!?。]+$/, "").trim();
  if (!title) title = "다음 업무 확인하기";
  if (!/(하기|정하기|확인|검토|작성|정리|적용|진행|기록|결정|시작|준비|회신|공유|설정|수정|보강|학습)$/i.test(title)) title += " 하기";
  return title.slice(0, 90);
}
function normalizeKey(value) { return clean(value, 180).toLowerCase().replace(/[^a-z0-9가-힣]+/gi, ""); }
function questId(title, project) { return `quest-${createHash("sha256").update(`${normalizeKey(title)}|${normalizeKey(project)}`).digest("hex").slice(0, 12)}`; }
function estimateFor(text) { return text.length > 110 ? 60 : text.length > 65 ? 45 : text.length > 35 ? 30 : 15; }
function makeQuest(candidate, index) {
  const title = titleFor(candidate.text); const project = clean(candidate.project || "오늘의 업무", 80); const estimateMinutes = estimateFor(`${title} ${candidate.firstStep}`);
  const status = /막힘|blocked/i.test(candidate.label) ? "blocked" : /보류|paused/i.test(candidate.label) ? "paused" : /확인 필요|needs confirmation/i.test(candidate.label) ? "needs_confirmation" : "not_started";
  const steps = [candidate.firstStep, candidate.doneWhen].filter(Boolean).map((label, stepIndex) => ({ id: `step-${index + 1}-${stepIndex + 1}`, label: clean(label, 180), completed: false }));
  return { id: questId(title, project), title, project, category: candidate.category === "main" ? "main" : "side", status, summary: clean(candidate.text, 260), firstStep: clean(candidate.firstStep || candidate.text, 240), doneWhen: clean(candidate.doneWhen || "결과와 근거를 기록하면 완료", 240), estimateMinutes, points: Math.max(40, Math.min(240, estimateMinutes * 4 + (candidate.category === "main" ? 20 : 0))), steps, sourceLabel: clean(candidate.sourceLabel || "업무일기", 100), sourcePath: candidate.sourcePath || "diary://unknown", reports: [] };
}
function parseArgs(argv) {
  const args = { input: [] };
  for (let i = 0; i < argv.length; i += 1) { const value = argv[i]; if (value === "--input") args.input.push(argv[++i]); else if (value === "--target-date") args.targetDate = argv[++i]; else if (value === "--source-date") args.sourceDate = argv[++i]; else if (value === "--output") args.output = argv[++i]; else if (value === "--print") args.print = true; else if (value === "--self-test") args.selfTest = true; }
  return args;
}
function compile({ targetDate = kstToday(), sourceDate = shiftDate(targetDate, -1), input = [], output, print = false }) {
  let sources;
  if (input.length) {
    sources = input.map((path) => ({ path: resolve(path), label: "사용자 지정 업무일기", safePath: safeSourcePath("input", sourceDate) }));
  } else {
    sources = [];
    for (let offset = 0; offset < 8 && !sources.length; offset += 1) {
      const candidateDate = shiftDate(sourceDate, -offset);
      sources = defaultSources(candidateDate).filter((item) => existsSync(item.path));
      if (sources.length) sourceDate = candidateDate;
    }
  }
  const candidates = [];
  for (const source of sources) { const text = readFileSync(source.path, "utf8"); const json = source.path.toLowerCase().endsWith(".json") ? readJson(source.path) : null; if (json) parseJsonCandidates(json, source, candidates); else candidates.push(...parseMarkdown(text, source)); }
  const unique = new Map();
  for (const candidate of candidates) { const title = titleFor(candidate.text); const key = normalizeKey(title); if (key && !unique.has(key)) unique.set(key, { ...candidate, text: title }); }
  const board = { schemaVersion: 1, activityDate: targetDate, sourceDate, sourceInputs: sources.map((source) => source.safePath), title: `${targetDate} 오늘의 퀘스트`, generatedAt: new Date().toISOString(), sourceCoverage: sources.length ? "connected" : "stale", quests: [...unique.values()].map(makeQuest) };
  const outputPath = output ? resolve(output) : join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Daybridge", "boards", `${targetDate}.json`);
  const existing = readJson(outputPath);
  if (existing && Array.isArray(existing.quests)) {
    if (!sources.length) board.quests = existing.quests;
    const previous = new Map(existing.quests.map((quest) => [quest.id, quest]));
    board.quests = board.quests.map((quest) => {
      const old = previous.get(quest.id);
      return old ? { ...quest, status: old.status || quest.status, steps: Array.isArray(old.steps) ? old.steps : quest.steps, reports: Array.isArray(old.reports) ? old.reports : [], updatedAt: old.updatedAt } : quest;
    });
  }
  if (output || !print) { mkdirSync(dirname(outputPath), { recursive: true }); writeFileSync(outputPath, JSON.stringify(board, null, 2) + "\n", "utf8"); }
  if (print || !output) console.log(JSON.stringify(board, null, 2)); else console.log(`Compiled ${board.quests.length} quests from ${sources.length} source(s): ${outputPath}`);
  return board;
}
function selfTest() {
  const sample = "# 내일 첫 행동\n- 공식 근거를 확인하고 범위를 정리한다\n# 완료\n- 구현 및 검증 완료\n# 미완료·막힘\n- 접근 경로를 결정해야 한다"; const parsed = parseMarkdown(sample, { label: "fixture", safePath: "fixture://sample" }); const board = { quests: parsed.map(makeQuest) };
  const fixtureSecret = "pass" + "word: " + "fixture-" + "value";
  if (board.quests.length !== 2 || board.quests.some((quest) => quest.status === "completed") || clean(fixtureSecret).includes("fixture-value")) throw new Error("Compiler self-test failed."); console.log("compile-quests self-test passed");
}
const args = parseArgs(process.argv.slice(2)); if (args.selfTest) selfTest(); else compile(args);
