/**
 * These are deliberately small, opt-out suggestions—not obligations. They are
 * considered only after the briefing's concrete quests have been placed.
 */
export const DEFAULT_ROUTINES = Object.freeze([
  Object.freeze({ id: "supplement", title: "영양제 먹기", estimateMinutes: 25, days: [0, 1, 2, 3, 4, 5, 6], category: "health" }),
]);

function weekday(date) { return new Date(`${date}T12:00:00+09:00`).getUTCDay(); }
function clean(value, limit = 100) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit); }
function validMinutes(value) { const minutes = Number(value); return Number.isInteger(minutes) && (minutes === 25 || minutes === 50) ? minutes : null; }

function normalizeRoutine(raw, index) {
  const id = clean(raw?.id || `routine-${index + 1}`, 80).toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "");
  const title = clean(raw?.title, 120);
  const estimateMinutes = validMinutes(raw?.estimateMinutes ?? raw?.durationMinutes);
  const days = [...new Set((Array.isArray(raw?.days) ? raw.days : []).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  if (!id || !title || !estimateMinutes || !days.length || raw?.enabled === false) return null;
  return { id: `routine-${id}`, title, estimateMinutes, remainingMinutes: estimateMinutes, priority: "could", state: "ready", dependsOn: [], execution: "independent", sourceRefs: [], sourceKind: "routine", category: clean(raw?.category || "routine", 40), days };
}

/** Turns the briefing board plus personal routine defaults into optional task candidates. */
export function buildRoutineCandidates({ date, board, routines = DEFAULT_ROUTINES } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new TypeError("Routine planning needs a YYYY-MM-DD date");
  const titles = new Set((Array.isArray(board?.quests) ? board.quests : []).map((quest) => clean(quest?.title).toLowerCase()).filter(Boolean));
  const selected = (Array.isArray(routines) ? routines : []).map(normalizeRoutine).filter(Boolean)
    .filter((routine) => routine.days.includes(weekday(date)))
    .filter((routine) => !titles.has(routine.title.toLowerCase()));
  // Keep the default list intentionally small; user-selected work always wins.
  return selected.slice(0, 2).map(({ days, ...candidate }) => candidate);
}
