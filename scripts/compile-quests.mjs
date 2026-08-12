import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ACTION_WORDS = /확인|검토|대조|정비|적용|작성|회신|기록|실행|진행|결정|추가|수정|정리|검증|준비|연락|공유|설정|열기|시작|보강|학습|분류|재개|이관|review|check|verify|draft|write|send|record|run|decide|prepare|update/i;
const COMPLETED_WORDS = /완료(?:됨|했다)?|구현(?:됨|했다)?|처리했다|끝냈|finished|done|completed/i;
const META_WORDS = /^(?:목표|한 일|결과|검증|안전|상태|결정|근거|evidence|source|summary|목적)\s*[:：]/i;
const SECTION_WORDS = /다음 행동|내일.*행동|남은 작업|권장 다음 행동|recommended next action|next action|확인 필요|미완료|막힘|todo|할 일/i;
const SECRET_WORDS = /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret|cookie|session[_ -]?token|private[_ -]?key)\s*[:=]\s*[^\s]+/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g;
const LOCAL_PATH = /\b[A-Z]:\\[^\s|]+/gi;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAIN_QUEST_LIMIT = 5;

function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function isDate(value) {
  if (!DATE.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function shiftDate(date, amount) {
  const value = new Date(`${date}T12:00:00+09:00`);
  value.setDate(value.getDate() + amount);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(value);
}

export function nextBusinessDay(date) {
  let candidate = shiftDate(date, 1);
  while ([0, 6].includes(new Date(`${candidate}T12:00:00+09:00`).getUTCDay())) {
    candidate = shiftDate(candidate, 1);
  }
  return candidate;
}

function previousBusinessDay(date) {
  let candidate = shiftDate(date, -1);
  while ([0, 6].includes(new Date(`${candidate}T12:00:00+09:00`).getUTCDay())) {
    candidate = shiftDate(candidate, -1);
  }
  return candidate;
}

function clean(value, limit = 360) {
  return String(value || "")
    .replace(/```[^`]*```/g, "")
    .replace(/!?(\[[^\]]*\])\([^)]*\)/g, "$1")
    .replace(EMAIL, "[email removed]")
    .replace(PHONE, "[phone removed]")
    .replace(SECRET_WORDS, "[sensitive value removed]")
    .replace(LOCAL_PATH, "[local path]")
    .replace(/\s+/g, " ")
    .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .trim()
    .slice(0, limit)
    .trim();
}

function safeSourcePath(kind, date, suffix = "") {
  return `${kind}://${date}${suffix ? `/${suffix}` : ""}`;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(temporary, path);
}

function profileRoot() {
  const appData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const profile = readJson(join(appData, "AIHUB", "environment.json"));
  return profile && typeof profile.aihub_root === "string" ? profile.aihub_root : null;
}

function defaultDiarySource(sourceDate) {
  const diaryDir = join(homedir(), "Desktop", "KTH", "업무자료", "AI_Work_Diary", "daily");
  return {
    path: join(diaryDir, `${sourceDate}_ai_work_diary.md`),
    label: "KTH 업무일기",
    safePath: safeSourcePath("diary", sourceDate),
  };
}

function closeoutPaths(aihubRoot, sourceDate) {
  const system = join(aihubRoot, "04_Operations_And_Automation", "Memory_System", "reports", "daily", "_system");
  return {
    briefing: join(system, `${sourceDate}_briefing_synthesis.json`),
    unified: join(system, `${sourceDate}_unified.json`),
  };
}

function closeoutWarning(packet, sourceDate) {
  if (!packet || typeof packet !== "object") return "Closeout packet could not be read.";
  if (packet.artifact_type !== "aihub_briefing_synthesis") return "Closeout packet type is not recognized.";
  if (packet.phase !== "closeout") return "Closeout packet is not a closeout synthesis.";
  if (packet.activity_date !== sourceDate) return "Closeout packet date does not match the requested source date.";
  if (!isDate(packet.activity_date)) return "Closeout packet has an invalid activity date.";
  if (packet.activity_date > kstToday()) return "Closeout packet has a future activity date.";
  if (packet.status && packet.status !== "ready") return `Closeout packet is not ready (${clean(packet.status, 40)}).`;
  return null;
}

function normaliseKey(value) {
  return clean(value, 180).toLowerCase().replace(/[^a-z0-9가-힣]+/gi, "");
}

export function titleFor(action) {
  const cardEvidence = clean(action, 180).match(/(?:(\d+개)\s*)?카드.*원문.*확인 필요/i);
  if (cardEvidence) {
    const count = cardEvidence[1] ? `${cardEvidence[1]} ` : "";
    return `${count}카드 원문 근거 확인하기`;
  }
  let title = clean(action, 120)
    .replace(/^(?:내일|오늘)\s+/, "")
    .replace(/^사용자가\s+/, "")
    .replace(/\s*(?:해야 한다|해야 함|한다|할 것|하기로 한다)\.?$/i, "")
    .replace(/[.!?。]+$/, "")
    .trim();
  if (!title) title = "다음 업무 확인하기";
  if (!/(하기|정하기|확인|검토|작성|정리|적용|진행|기록|결정|시작|준비|회신|공유|설정|수정|보강|학습|대조|분류|재개)$/i.test(title)) {
    title += " 하기";
  }
  return title.slice(0, 90);
}

function projectFromEvidence(evidence) {
  const path = clean(evidence, 300).replaceAll("\\", "/");
  if (/01_Projects\/TCG_Trade_Web/i.test(path)) return "TCG Trade Web";
  if (/01_Projects\/DeckHub/i.test(path)) return "DeckHub";
  if (/01_Projects\/DeckSigil/i.test(path)) return "DeckSigil";
  if (/01_Projects\/shortform-channel-ops/i.test(path)) return "콘텐츠 운영";
  if (/01_Projects\/Marineford_TCG_Platform/i.test(path)) return "Marineford 운영";
  if (/01_Projects\/Daybridge/i.test(path)) return "Daybridge";
  if (/Skills_And_Prompts/i.test(path)) return "학습자료";
  if (/MIRAE_ING/i.test(path) || /mail/i.test(path)) return "회사 업무";
  return "오늘의 업무";
}

function projectForRaw(value) {
  const text = clean(value, 100);
  if (text === "Skills_And_Prompts") return "학습자료";
  if (text === "TCG_Trade_Web") return "TCG Trade Web";
  if (text === "MIRAE_ING 회사 업무") return "회사 업무";
  return text || "오늘의 업무";
}

function projectResolver(unified) {
  const byEvidence = new Map();
  const byTitle = new Map();
  const records = Array.isArray(unified?.work?.worklog_records) ? unified.work.worklog_records : [];
  for (const record of records) {
    const project = projectForRaw(record?.project);
    const title = normaliseKey(record?.title);
    if (title) byTitle.set(title, project);
    for (const evidence of Array.isArray(record?.evidence_refs) ? record.evidence_refs : []) {
      const key = normaliseKey(evidence);
      if (key) byEvidence.set(key, project);
    }
  }
  const mail = Array.isArray(unified?.work?.mail_records) ? unified.work.mail_records : [];
  for (const record of mail) {
    const title = normaliseKey(record?.subject);
    if (title) byTitle.set(title, projectForRaw(record?.project_ref));
  }
  return (value, evidence) => byEvidence.get(normaliseKey(evidence)) || byTitle.get(normaliseKey(value)) || projectFromEvidence(evidence);
}

function statusForLabel(label) {
  if (/막힘|blocked/i.test(label)) return "blocked";
  if (/보류|paused/i.test(label)) return "paused";
  if (/확인 필요|needs confirmation|완료 여부 미확인/i.test(label)) return "needs_confirmation";
  return "not_started";
}

function isCoverageQuestion(value) {
  return /activity coverage|대화 handoff|conversation handoff|record_quality|기록 품질|selected sources|세션 coverage/i.test(value);
}

function actionFromPolicy(value) {
  const text = clean(value);
  const match = text.match(/^(.+?)(?:은|는)\s+외부 공식 원문 대조 전까지 확정하지 않는다\.?$/);
  if (match) {
    const subject = clean(match[1], 120);
    return {
      text: `${subject} 공식 원문 대조하기`,
      firstStep: `공식 원문에서 ${subject}의 근거 위치를 확인한다`,
      doneWhen: `${subject}의 근거와 적용 범위를 기록한다`,
    };
  }
  return null;
}

function isPolicyOnly(value) {
  return /(?:앞으로|항상|기본적으로|원칙|정책).*(?:적용|유지|작성|사용)|(?:확정하지 않는다|승격하지 않는다|대체 근거로).*$/i.test(value);
}

function looksLikeAction(value) {
  return ACTION_WORDS.test(value) && !COMPLETED_WORDS.test(value) && !META_WORDS.test(value);
}

function makeCandidate(value, context) {
  const raw = typeof value === "string" ? { title: value } : value && typeof value === "object" ? value : null;
  if (!raw) return null;
  const original = clean(raw.title || raw.action || raw.next_action || raw.nextAction || raw.text || raw.next_step || "");
  if (!original || COMPLETED_WORDS.test(original)) return null;
  const replacement = actionFromPolicy(original);
  if (!replacement && (isPolicyOnly(original) || !looksLikeAction(original))) return null;
  const evidence = clean(raw.evidence || raw.source_ref || context.evidence || "", 300);
  const text = replacement?.text || original;
  const label = clean(raw.label || context.label || "다음 행동", 100);
  const firstStep = clean(replacement?.firstStep || raw.first_step || raw.firstStep || raw.next_step || raw.nextAction || text, 240);
  const doneWhen = clean(replacement?.doneWhen || raw.done_when || raw.doneWhen || context.doneWhen || "결과와 근거를 기록하면 완료", 240);
  return {
    text,
    label,
    firstStep,
    doneWhen,
    project: context.resolveProject(text, evidence),
    priority: context.priority,
    category: context.category,
    sourceLabel: context.sourceLabel,
    sourcePath: context.sourcePath,
    evidence,
    status: statusForLabel(label),
  };
}

function addCandidates(target, values, context) {
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value === "string" && isCoverageQuestion(value)) continue;
    const candidate = makeCandidate(value, context);
    if (candidate) target.push(candidate);
  }
}

function closeoutCandidates(packet, unified, sourceDate) {
  const candidates = [];
  const resolveProject = projectResolver(unified);
  const base = {
    sourceLabel: "AIHUB closeout",
    sourcePath: safeSourcePath("aihub", sourceDate, "briefing"),
    resolveProject,
  };
  addCandidates(candidates, packet.tomorrow_first_steps, { ...base, label: "내일 첫 행동", priority: 100, category: "main" });
  addCandidates(candidates, packet.immediate_actions, { ...base, label: "오늘 바로 할 일", priority: 90, category: "main" });
  addCandidates(candidates, packet.open_items, { ...base, label: "미완료·막힘", priority: 60, category: "side" });
  addCandidates(candidates, packet.confirmation_questions, { ...base, label: "확인 필요", priority: 40, category: "side" });
  return candidates;
}

function parseMarkdown(text, context) {
  const lines = String(text || "").split(/\r?\n/);
  const candidates = [];
  let section = "";
  let pendingFirst = "";
  let pendingDone = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s*/.test(line)) {
      section = clean(line.replace(/^#{1,6}\s*/, ""), 120);
      pendingFirst = "";
      pendingDone = "";
      continue;
    }
    const first = line.match(/^(?:첫 행동|첫 단계|first step)\s*[:：]\s*(.+)$/i);
    if (first) {
      pendingFirst = clean(first[1], 240);
      continue;
    }
    const done = line.match(/^(?:완료 기준|완료 조건|done when|completion)\s*[:：]\s*(.+)$/i);
    if (done) {
      pendingDone = clean(done[1], 240);
      continue;
    }
    const inline = line.match(/^(?:다음 행동|요청\/다음 행동|next action|next_action|내일 첫 행동|남은 작업|todo)\s*[:：]\s*(.+)$/i);
    const bullet = line.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    const bulletField = bullet?.[1]?.match(/^(?:다음 행동|요청\/다음 행동|next action|next_action|내일 첫 행동|남은 작업|todo)\s*[:：]\s*(.+)$/i);
    const textValue = inline?.[1] || bulletField?.[1] || bullet?.[1];
    const isActionSection = SECTION_WORDS.test(section) || Boolean(inline) || Boolean(bulletField);
    if (!isActionSection || !textValue) continue;
    const label = /막힘|blocked/i.test(section) ? "막힘" : /보류|paused/i.test(section) ? "보류" : /확인 필요|needs confirmation/i.test(section) ? "확인 필요" : section || "다음 행동";
    const candidate = makeCandidate({ title: textValue, first_step: pendingFirst, done_when: pendingDone }, { ...context, label, priority: /내일|tomorrow|다음 행동|next action|immediate/i.test(section) ? 80 : 50, category: "main" });
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function deduplicate(candidates) {
  const unique = new Map();
  for (const candidate of candidates) {
    const key = normaliseKey(titleFor(candidate.text));
    if (!key) continue;
    const previous = unique.get(key);
    if (!previous || candidate.priority > previous.priority) unique.set(key, candidate);
  }
  return [...unique.values()];
}

function groupTitle(project, candidates) {
  if (candidates.length === 1) return titleFor(candidates[0].text);
  const known = {
    "학습자료": "학습자료 근거 확인하기",
    "회사 업무": "회사 업무 확인하기",
    "TCG Trade Web": "TCG Trade Web 배포 준비하기",
    "DeckHub": "DeckHub 검토 이어가기",
    "DeckSigil": "DeckSigil 검증 이어가기",
    "Marineford 운영": "Marineford 운영 경계 정리하기",
    "콘텐츠 운영": "콘텐츠 운영 검수 이어가기",
    "Daybridge": "Daybridge 개선 이어가기",
  };
  return known[project] || `${project} 이어가기`;
}

function groupStatus(candidates) {
  const statuses = candidates.map((candidate) => candidate.status);
  if (statuses.includes("not_started")) return "not_started";
  if (statuses.includes("needs_confirmation")) return "needs_confirmation";
  if (statuses.every((status) => status === "blocked")) return "blocked";
  if (statuses.every((status) => status === "paused")) return "paused";
  return statuses[0] || "not_started";
}

function questId(title, project) {
  return `quest-${createHash("sha256").update(`${normaliseKey(title)}|${normaliseKey(project)}`).digest("hex").slice(0, 12)}`;
}

function estimateFor(candidates) {
  const longest = Math.max(...candidates.map((candidate) => candidate.firstStep.length), 0);
  const base = longest > 110 ? 60 : longest > 65 ? 45 : longest > 35 ? 30 : 15;
  return Math.min(90, base + Math.max(0, candidates.length - 1) * 10);
}

function groupCandidates(candidates) {
  const grouped = new Map();
  for (const candidate of deduplicate(candidates)) {
    const key = normaliseKey(candidate.project) || "오늘의업무";
    const group = grouped.get(key) || { project: candidate.project, candidates: [], priority: 0 };
    group.candidates.push(candidate);
    group.priority = Math.max(group.priority, candidate.priority);
    grouped.set(key, group);
  }
  const ordered = [...grouped.values()].sort((left, right) => right.priority - left.priority || left.project.localeCompare(right.project, "ko"));
  return ordered.map((group, index) => {
    const candidatesForGroup = group.candidates.sort((left, right) => right.priority - left.priority || left.text.localeCompare(right.text, "ko"));
    const title = groupTitle(group.project, candidatesForGroup);
    const estimateMinutes = estimateFor(candidatesForGroup);
    const source = candidatesForGroup[0];
    const steps = candidatesForGroup.map((candidate, stepIndex) => ({
      id: `step-${index + 1}-${stepIndex + 1}`,
      label: clean(candidate.firstStep, 180),
      completed: false,
    }));
    return {
      id: questId(title, group.project),
      title,
      project: clean(group.project, 80),
      category: index < MAIN_QUEST_LIMIT ? "main" : "side",
      status: groupStatus(candidatesForGroup),
      summary: candidatesForGroup.length === 1 ? clean(source.text, 260) : `${candidatesForGroup.length}개의 closeout 다음 행동을 하나의 흐름으로 묶었습니다.`,
      firstStep: clean(source.firstStep, 240),
      doneWhen: candidatesForGroup.length === 1 ? clean(source.doneWhen, 240) : `${clean(group.project, 80)} 체크리스트의 결과와 근거를 기록하면 완료`,
      estimateMinutes,
      points: Math.max(40, Math.min(240, estimateMinutes * 4 + (index < MAIN_QUEST_LIMIT ? 20 : 0))),
      steps,
      sourceLabel: clean(source.sourceLabel, 100),
      sourcePath: source.sourcePath,
      reports: [],
    };
  });
}

function preserveReceipts(quests, outputPath) {
  const existing = readJson(outputPath);
  if (!existing || !Array.isArray(existing.quests)) return quests;
  const previous = new Map(existing.quests.map((quest) => [quest?.id, quest]));
  return quests.map((quest) => {
    const old = previous.get(quest.id);
    if (!old) return quest;
    return {
      ...quest,
      status: typeof old.status === "string" ? old.status : quest.status,
      steps: Array.isArray(old.steps) ? old.steps : quest.steps,
      reports: Array.isArray(old.reports) ? old.reports : [],
      updatedAt: typeof old.updatedAt === "string" ? old.updatedAt : undefined,
    };
  });
}

function parseArgs(argv) {
  const args = { input: [], source: "auto" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") args.input.push(argv[++index]);
    else if (value === "--target-date") args.targetDate = argv[++index];
    else if (value === "--source-date") args.sourceDate = argv[++index];
    else if (value === "--source") args.source = argv[++index];
    else if (value === "--output") args.output = argv[++index];
    else if (value === "--print") args.print = true;
    else if (value === "--self-test") args.selfTest = true;
  }
  return args;
}

function resolveDates(options) {
  const targetDate = isDate(options.targetDate) ? options.targetDate : null;
  const sourceDate = isDate(options.sourceDate) ? options.sourceDate : null;
  if (targetDate && sourceDate) return { targetDate, sourceDate };
  if (sourceDate) return { targetDate: nextBusinessDay(sourceDate), sourceDate };
  const today = targetDate || kstToday();
  return { targetDate: today, sourceDate: previousBusinessDay(today) };
}

function genericInputCandidates(sources, sourceDate) {
  const candidates = [];
  for (const source of sources) {
    const content = readFileSync(source.path, "utf8");
    const json = source.path.toLowerCase().endsWith(".json") ? readJson(source.path) : null;
    if (json?.artifact_type === "aihub_briefing_synthesis") {
      candidates.push(...closeoutCandidates(json, null, sourceDate));
    } else if (json) {
      candidates.push(...parseMarkdown(JSON.stringify(json), {
        sourceLabel: source.label,
        sourcePath: source.safePath,
        resolveProject: () => "오늘의 업무",
      }));
    } else {
      candidates.push(...parseMarkdown(content, {
        sourceLabel: source.label,
        sourcePath: source.safePath,
        resolveProject: () => "오늘의 업무",
      }));
    }
  }
  return candidates;
}

export function compile(options = {}) {
  const { targetDate, sourceDate } = resolveDates(options);
  const outputPath = options.output
    ? resolve(options.output)
    : join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Daybridge", "boards", `${targetDate}.json`);
  const source = ["auto", "closeout", "diary"].includes(options.source) ? options.source : "auto";
  const warnings = [];
  const sourceInputs = [];
  let sourceCoverage = "stale";
  let sourceQuality = "unknown";
  let candidates = [];

  if (Array.isArray(options.input) && options.input.length) {
    const inputs = options.input
      .map((path) => ({ path: resolve(path), label: "사용자 지정 입력", safePath: safeSourcePath("input", sourceDate) }))
      .filter((item) => existsSync(item.path));
    candidates = genericInputCandidates(inputs, sourceDate);
    sourceInputs.push(...inputs.map((item) => item.safePath));
    sourceCoverage = inputs.length ? "connected" : "stale";
  } else if (source !== "diary") {
    const aihubRoot = options.aihubRoot || profileRoot();
    if (aihubRoot) {
      const paths = closeoutPaths(aihubRoot, sourceDate);
      if (existsSync(paths.briefing)) {
        const packet = readJson(paths.briefing);
        const warning = closeoutWarning(packet, sourceDate);
        sourceInputs.push(safeSourcePath("aihub", sourceDate, "briefing"));
        if (warning) {
          warnings.push(warning);
          sourceCoverage = "attention";
        } else {
          const unified = existsSync(paths.unified) ? readJson(paths.unified) : null;
          if (unified) sourceInputs.push(safeSourcePath("aihub", sourceDate, "unified"));
          candidates = closeoutCandidates(packet, unified, sourceDate);
          const quality = packet?.coverage?.record_quality || packet?.execution?.record_quality || "unknown";
          sourceQuality = quality === "aligned" ? "aligned" : "attention";
          sourceCoverage = quality === "aligned" ? "connected" : "attention";
          if (sourceCoverage === "attention") warnings.push(`Closeout record quality is ${clean(quality, 50)}.`);
        }
      } else if (source === "closeout") {
        warnings.push("Closeout briefing packet was not found.");
        sourceCoverage = "attention";
      }
    } else if (source === "closeout") {
      warnings.push("AIHUB machine profile could not be resolved.");
      sourceCoverage = "attention";
    }
  }

  if (!candidates.length && !warnings.length && source !== "closeout") {
    const diary = defaultDiarySource(sourceDate);
    if (existsSync(diary.path)) {
      candidates = genericInputCandidates([diary], sourceDate);
      sourceInputs.push(diary.safePath);
      sourceCoverage = candidates.length ? "stale" : "attention";
      sourceQuality = "unknown";
      if (!candidates.length) warnings.push("The fallback diary did not contain a safe action candidate.");
    } else {
      warnings.push("No closeout packet or fallback diary was found.");
    }
  }

  const board = {
    schemaVersion: 1,
    activityDate: targetDate,
    sourceDate,
    sourceInputs,
    title: `${targetDate} 오늘의 퀘스트`,
    generatedAt: new Date().toISOString(),
    sourceCoverage,
    sourceQuality,
    sourceWarnings: warnings.map((warning) => clean(warning, 180)),
    quests: preserveReceipts(groupCandidates(candidates), outputPath),
  };

  if (options.output || !options.print) atomicWriteJson(outputPath, board);
  if (options.print || !options.output) console.log(JSON.stringify(board, null, 2));
  else console.log(`Compiled ${board.quests.length} parent quests from ${sourceInputs.length} source packet(s): ${outputPath}`);
  return board;
}

function selfTest() {
  const fixture = "# 내일 첫 행동\n- 공식 근거를 확인하고 범위를 정리한다\n# 완료\n- 구현 및 검증 완료\n# 미완료·막힘\n- 접근 경로를 결정해야 한다";
  const parsed = parseMarkdown(fixture, {
    sourceLabel: "fixture",
    sourcePath: "fixture://sample",
    resolveProject: () => "테스트",
  });
  const fixtureSecret = "pass" + "word: " + "fixture-" + "value";
  const grouped = groupCandidates(parsed);
  if (grouped.length !== 1 || grouped[0].steps.length !== 2 || clean(fixtureSecret).includes("fixture-value") || nextBusinessDay("2026-08-14") !== "2026-08-17") {
    throw new Error("Compiler self-test failed.");
  }
  console.log("compile-quests self-test passed");
}

const directExecution = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directExecution) {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) selfTest();
  else compile(args);
}
