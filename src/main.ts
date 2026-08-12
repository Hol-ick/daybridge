import "./styles.css";
import { demoQuestBoard } from "./demo-data";
import type { BridgeResponse, ProgressReportInput, Quest, QuestBoard, QuestStep } from "./types";

const BRIDGE_URL = "http://127.0.0.1:39393";
const STORAGE_KEY = "daybridge.quest-board.v3";

function loadStoredBoard(): QuestBoard {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as QuestBoard;
      if (Array.isArray(parsed.quests) && typeof parsed.activityDate === "string") return parsed;
    }
  } catch {
    // The demo board remains available when local browser storage is unavailable.
  }
  return structuredClone(demoQuestBoard);
}

let board = loadStoredBoard();
let expandedQuestId = "";
let celebratingTaskKey = "";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Daybridge could not find its application root.");
const app: HTMLElement = root;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function persistBoard(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch {
    // Reporting through the local bridge remains available when browser storage fails.
  }
}

function completedSteps(quest: Quest): number {
  return quest.steps.filter((step) => step.completed).length;
}

function taskKey(questId: string, stepId: string): string {
  return `${questId}:${stepId}`;
}

function subquestCard(quest: Quest, step: QuestStep, index: number): string {
  const complete = step.completed;
  const key = taskKey(quest.id, step.id);
  return `
    <button
      class="subquest-card ${complete ? "is-complete" : ""} ${celebratingTaskKey === key ? "is-celebrating" : ""}"
      type="button"
      data-action="toggle-step"
      data-quest-id="${quest.id}"
      data-step-id="${step.id}"
      aria-pressed="${complete}"
      style="--stagger: ${index}">
      <span class="subquest-check" aria-hidden="true">${complete ? "✓" : ""}</span>
      <strong>${escapeHtml(step.label)}</strong>
    </button>`;
}

function questCard(quest: Quest, index: number): string {
  const done = completedSteps(quest);
  const total = quest.steps.length;
  const progress = total ? Math.round((done / total) * 100) : 0;
  const open = expandedQuestId === quest.id;
  const finished = total > 0 && done === total;
  return `
    <article class="quest-card ${open ? "is-open" : ""} ${finished ? "is-finished" : ""}" style="--stagger: ${index}">
      <button class="quest-card-trigger" type="button" data-action="toggle-quest" data-id="${quest.id}" aria-expanded="${open}">
        <span class="quest-card-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="quest-card-copy"><strong>${escapeHtml(quest.title)}</strong><small>${open ? escapeHtml(quest.summary) : `${done}/${total}`}</small></span>
        <span class="quest-card-meter" aria-hidden="true"><i><em style="width: ${progress}%"></em></i></span>
        <span class="card-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="quest-details ${open ? "is-open" : ""}" aria-hidden="${!open}">
        <div class="quest-details-inner">
          <p class="quest-summary">${escapeHtml(quest.summary)}</p>
          <p class="quest-done-when">${escapeHtml(quest.doneWhen)}</p>
          <div class="subquest-list" aria-label="${escapeHtml(quest.title)} sub-quests">
            ${quest.steps.map((step, stepIndex) => subquestCard(quest, step, stepIndex)).join("")}
          </div>
        </div>
      </div>
    </article>`;
}

function render(): void {
  app.innerHTML = `
    <main class="widget-shell">
      <header class="widget-header" data-tauri-drag-region>
        <span class="brand"><span class="brand-mark">✦</span><span>daybridge</span></span>
        <div class="window-actions">
          <button class="icon-button" type="button" data-action="sync" aria-label="새로고침">↻</button>
          <button class="icon-button desktop-only" type="button" data-action="minimize" aria-label="최소화">−</button>
          <button class="icon-button desktop-only" type="button" data-action="close-window" aria-label="닫기">×</button>
        </div>
      </header>
      <section class="widget-body">
        <div class="quest-list">${board.quests.map(questCard).join("") || `<div class="empty-state">오늘의 퀘스트가 없습니다.</div>`}</div>
      </section>
    </main>`;
}

function updateQuest(questId: string, transform: (quest: Quest) => Quest): Quest | undefined {
  let updated: Quest | undefined;
  board = {
    ...board,
    quests: board.quests.map((quest) => {
      if (quest.id !== questId) return quest;
      updated = transform({ ...quest, steps: quest.steps.map((step) => ({ ...step })), reports: [...quest.reports] });
      return updated;
    }),
  };
  persistBoard();
  return updated;
}

function celebrateTask(key: string): void {
  celebratingTaskKey = key;
  window.setTimeout(() => {
    if (celebratingTaskKey === key) {
      celebratingTaskKey = "";
      render();
    }
  }, 520);
}

async function sendReport(input: ProgressReportInput): Promise<void> {
  const quest = updateQuest(input.questId, (current) => ({
    ...current,
    status: input.status,
    steps: input.steps ? input.steps.map((step) => ({ ...step })) : current.steps,
    updatedAt: new Date().toISOString(),
    reports: [
      ...current.reports,
      {
        id: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        status: input.status,
        note: input.note,
        nextAction: input.nextAction,
        source: "daybridge" as const,
      },
    ].slice(-20),
  }));
  if (!quest) return;

  render();
  try {
    const response = await fetch(`${BRIDGE_URL}/api/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activityDate: board.activityDate,
        questId: input.questId,
        status: input.status,
        note: input.note,
        nextAction: input.nextAction,
        steps: quest.steps,
      }),
    });
    if (!response.ok) throw new Error("bridge unavailable");
    const result = (await response.json()) as BridgeResponse;
    board = result.board;
    persistBoard();
  } catch {
    // The local board retains the user receipt until the bridge is available again.
  }
  render();
}

function currentKstDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

async function loadConnectedBoard(): Promise<void> {
  try {
    const response = await fetch(`${BRIDGE_URL}/api/board?date=${currentKstDate()}`);
    if (!response.ok) return;
    const result = (await response.json()) as BridgeResponse;
    board = result.board;
    expandedQuestId = "";
    persistBoard();
    render();
  } catch {
    // The widget remains usable with its local board when the bridge is unavailable.
  }
}

function isDesktopShell(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function windowAction(action: "minimize" | "close"): Promise<void> {
  if (!isDesktopShell()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const currentWindow = getCurrentWindow();
  if (action === "minimize") await currentWindow.minimize();
  else await currentWindow.close();
}

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const actionTarget = target.closest<HTMLElement>("[data-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;
  if (action === "toggle-quest") {
    const id = actionTarget.dataset.id;
    if (!id) return;
    expandedQuestId = expandedQuestId === id ? "" : id;
    render();
  } else if (action === "toggle-step") {
    const questId = actionTarget.dataset.questId;
    const stepId = actionTarget.dataset.stepId;
    const quest = board.quests.find((item) => item.id === questId);
    if (!quest || !questId || !stepId) return;

    const steps = quest.steps.map((step) => (step.id === stepId ? { ...step, completed: !step.completed } : step));
    const allComplete = steps.length > 0 && steps.every((step) => step.completed);
    const completed = steps.filter((step) => step.completed).length;
    celebrateTask(taskKey(questId, stepId));
    void sendReport({
      questId,
      status: allComplete ? "completed" : "in_progress",
      note: `${completed}/${steps.length} sub-quests checked`,
      nextAction: steps.find((step) => !step.completed)?.label ?? "",
      steps,
    });
  } else if (action === "sync") {
    void loadConnectedBoard();
  } else if (action === "minimize") {
    void windowAction("minimize");
  } else if (action === "close-window") {
    void windowAction("close");
  }
});

render();
void loadConnectedBoard();
