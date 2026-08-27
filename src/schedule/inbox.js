const INBOX_ARTIFACT = "daybridge_schedule_inbox";
const INBOX_SCHEMA_VERSION = "1";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;
const ALLOWED_STATES = new Set(["ready", "in_progress", "deferred"]);
const ALLOWED_PRIORITIES = new Set(["must", "should", "could"]);
const ALLOWED_EXECUTION = new Set(["independent", "sequential"]);
const CLOCK_PATTERN = /(?<!\d)(?:[01]\d|2[0-3]):[0-5]\d(?!\d)/;
const COLUMNS = ["id", "title", "focus_units", "remaining_units", "state", "priority", "execution", "depends_on", "first_action", "done_when", "source_refs"];

function unescapeCell(value) {
  return String(value || "").replace(/\\\|/g, "|").replace(/\\\\/g, "\\").trim();
}

function splitRow(line) {
  let value = String(line || "").trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  const cells = [];
  let current = "";
  let escaped = false;
  for (const character of value) {
    if (character === "|" && !escaped) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
    escaped = character === "\\" && !escaped;
  }
  cells.push(current.trim());
  return cells;
}

function parseFrontMatter(markdown) {
  const lines = String(markdown || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { metadata: null, bodyLines: lines, errors: ["front matter가 ---로 시작하지 않습니다."] };
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing < 0) return { metadata: null, bodyLines: lines, errors: ["front matter 종료 구분자가 없습니다."] };
  const metadata = {};
  for (const line of lines.slice(1, closing)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return { metadata, bodyLines: lines.slice(closing + 1), errors: [] };
}

function parseList(value) {
  return String(value || "").split(",").map((item) => unescapeCell(item)).map((item) => item.trim()).filter(Boolean);
}

function positiveUnits(value, field, errors, rowNumber) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 24) {
    errors.push(`행 ${rowNumber}: ${field}는 1~24 정수여야 합니다.`);
    return null;
  }
  return number;
}

function hasForbiddenTimeField(row) {
  return Object.keys(row).some((key) => ["start_time", "end_time", "startTime", "endTime", "time", "time_range"].includes(key));
}

/**
 * Parse a date-scoped Daybridge Markdown inbox into scheduler candidates.
 * The parser is intentionally strict: malformed rows are excluded rather
 * than silently becoming a schedule block.
 */
export function parseScheduleInboxMarkdown(markdown, { date = null } = {}) {
  const { metadata, bodyLines, errors } = parseFrontMatter(markdown);
  const result = { valid: errors.length === 0, date: metadata?.schedule_date || null, timezone: metadata?.timezone || null, updatedAt: metadata?.updated_at || null, tasks: [], excluded: [], warnings: [], errors: [...errors] };
  if (!metadata) return result;
  if (metadata.artifact_type !== INBOX_ARTIFACT) result.errors.push(`artifact_type이 ${INBOX_ARTIFACT}가 아닙니다.`);
  if (metadata.schema_version !== INBOX_SCHEMA_VERSION) result.errors.push(`지원하지 않는 schema_version입니다: ${metadata.schema_version || "없음"}`);
  if (!DATE_PATTERN.test(metadata.schedule_date || "")) result.errors.push("schedule_date가 YYYY-MM-DD 형식이 아닙니다.");
  if (date && metadata.schedule_date !== date) result.errors.push(`파일 날짜(${metadata.schedule_date})와 요청 날짜(${date})가 다릅니다.`);
  if (metadata.timezone !== "Asia/Seoul") result.errors.push("timezone은 Asia/Seoul이어야 합니다.");

  let headerIndex = -1;
  for (let index = 0; index < bodyLines.length; index += 1) {
    const cells = splitRow(bodyLines[index]).map(unescapeCell);
    if (bodyLines[index].trim().startsWith("|") && cells.includes("id") && cells.includes("title")) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex < 0) {
    result.errors.push("일정 표 헤더를 찾을 수 없습니다.");
    result.valid = false;
    return result;
  }
  const header = splitRow(bodyLines[headerIndex]).map(unescapeCell);
  if (JSON.stringify(header) !== JSON.stringify(COLUMNS)) {
    result.errors.push("일정 표의 열 순서가 계약과 다릅니다.");
    result.valid = false;
    return result;
  }
  const seen = new Set();
  for (let index = headerIndex + 2; index < bodyLines.length; index += 1) {
    const line = bodyLines[index];
    if (!line.trim().startsWith("|")) continue;
    const rowNumber = index + 1;
    const cells = splitRow(line);
    if (cells.length !== COLUMNS.length) {
      result.excluded.push({ row: rowNumber, reason: "열 개수가 올바르지 않습니다." });
      continue;
    }
    const row = Object.fromEntries(COLUMNS.map((column, columnIndex) => [column, unescapeCell(cells[columnIndex])]));
    const rowErrors = [];
    if (!ID_PATTERN.test(row.id)) rowErrors.push("id가 소문자 kebab-case가 아닙니다.");
    if (!row.title || row.title.length > 500) rowErrors.push("title이 비어 있거나 너무 깁니다.");
    if (CLOCK_PATTERN.test(row.title)) rowErrors.push("title에 고정 시각을 넣을 수 없습니다.");
    if (seen.has(row.id)) rowErrors.push("id가 중복됩니다.");
    seen.add(row.id);
    const focusUnits = positiveUnits(row.focus_units, "focus_units", rowErrors, rowNumber);
    const remainingUnits = positiveUnits(row.remaining_units, "remaining_units", rowErrors, rowNumber);
    if (focusUnits && remainingUnits && remainingUnits > focusUnits) rowErrors.push("remaining_units가 focus_units보다 큽니다.");
    if (!ALLOWED_STATES.has(row.state)) rowErrors.push(`허용되지 않은 state입니다: ${row.state}`);
    if (!ALLOWED_PRIORITIES.has(row.priority)) rowErrors.push(`허용되지 않은 priority입니다: ${row.priority}`);
    if (!ALLOWED_EXECUTION.has(row.execution)) rowErrors.push(`허용되지 않은 execution입니다: ${row.execution}`);
    if (hasForbiddenTimeField(row)) rowErrors.push("고정 시각 필드는 허용하지 않습니다.");
    if (rowErrors.length) {
      result.excluded.push({ row: rowNumber, id: row.id || null, reason: rowErrors.join(" ") });
      continue;
    }
    result.tasks.push({
      id: row.id,
      questId: row.id,
      title: row.title,
      scheduleTitle: row.title,
      displayTitle: row.title,
      priority: row.priority,
      state: row.state,
      status: row.state,
      execution: row.execution,
      dependsOn: parseList(row.depends_on),
      focusUnits,
      remainingUnits,
      estimateMinutes: focusUnits * 50,
      durationMinutes: focusUnits * 50,
      remainingMinutes: remainingUnits * 50,
      currentAction: row.first_action || row.title,
      firstStep: row.first_action || row.title,
      doneWhen: row.done_when || null,
      sourceKind: "briefing",
      sourceLabel: "AIHUB 일정 inbox",
      sourceRefs: parseList(row.source_refs),
    });
  }
  result.valid = result.errors.length === 0;
  return result;
}

export const scheduleInboxColumns = [...COLUMNS];
