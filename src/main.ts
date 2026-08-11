import "./styles.css";
import { demoQuestBoard } from "./demo-data";
import type {
  BridgeResponse,
  ProgressReportInput,
  Quest,
  QuestBoard,
  QuestFilter,
  QuestStatus,
  QuestStep,
} from "./types";

const BRIDGE_URL = "http://127.0.0.1:39393";

const statusCopy: Record<QuestStatus, string> = {
  not_started: "미완료",
  in_progress: "진행 중",
  completed: "완료",
  blocked: "막힘",
  paused: "보류",
  needs_confirmation: "확인 필요",
};

const statusClass: Record<QuestStatus, string> = {
  not_started: "neutral",
  in_progress: "blue",
  completed: "green",
  blocked: "red",
  paused: "purple",
  needs_confirmation: "amber",
};

const STORAGE_KEY = "daybridge.quest-board.v1";

function loadStoredBoard(): QuestBoard {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as QuestBoard;
      if (parsed && Array.isArray(parsed.quests) && typeof parsed.activityDate === "string") {
        return parsed;
      }
    }
  } catch {
    // A browser storage failure should not block the preview.
  }
  return structuredClone(demoQuestBoard);
}

let board: QuestBoard = loadStoredBoard();
let filter: QuestFilter = "all";
let selectedQuestId = board.quests[0]?.id ?? "";
let connection: "connected" | "local" = "local";
let syncMessage = "데모 보드입니다. 로컬 브리지를 시작하면 실제 handoff와 연결됩니다.";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Daybridge could not find its application root.");
}

const app: HTMLElement = root;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${year}.${month}.${day}`;
}

function statusOptions(current: QuestStatus): string {
  return (Object.keys(statusCopy) as QuestStatus[])
    .map((status) => `<option value="${status}" ${status === current ? "selected" : ""}>${statusCopy[status]}</option>`)
    .join("");
}

function isActive(quest: Quest): boolean {
  return !["completed", "paused"].includes(quest.status);
}

function visibleQuests(): Quest[] {
  return board.quests.filter((quest) => {
    if (filter === "all") {
      return true;
    }
    if (filter === "active") {
      return isActive(quest);
    }
    return quest.status === filter;
  });
}

function completedPoints(): number {
  return board.quests
    .filter((quest) => quest.status === "completed")
    .reduce((sum, quest) => sum + quest.points, 0);
}

function maximumPoints(): number {
  return board.quests.reduce((sum, quest) => sum + quest.points, 0);
}

function completedCount(): number {
  return board.quests.filter((quest) => quest.status === "completed").length;
}

function achievementPercent(): number {
  const total = maximumPoints();
  return total === 0 ? 0 : Math.round((completedPoints() / total) * 100);
}

function selectedQuest(): Quest | undefined {
  return board.quests.find((quest) => quest.id === selectedQuestId) ?? board.quests[0];
}

function questCard(quest: Quest, index: number): string {
  const complete = quest.status === "completed";
  const checked = quest.steps.filter((step) => step.completed).length;
  const source = quest.sourcePath === "demo://daily-note" ? "데모 기록" : quest.sourceLabel;
  const progress = quest.steps.length ? Math.round((checked / quest.steps.length) * 100) : 0;

  return `
    <article class="quest-card ${complete ? "is-complete" : ""}">
      <div class="quest-marker" aria-hidden="true">${index + 1}</div>
      <div class="quest-body">
        <div class="quest-meta">
          <span class="status-pill ${statusClass[quest.status]}">${statusCopy[quest.status]}</span>
          <span>${escapeHtml(quest.project)}</span>
          <span>${quest.category === "main" ? "메인 퀘스트" : "사이드 퀘스트"}</span>
          <span>+${quest.points} XP</span>
        </div>
        <div class="quest-heading">
          <h2>${escapeHtml(quest.title)}</h2>
          <label class="status-select">
            <span class="sr-only">${escapeHtml(quest.title)} 상태</span>
            <select data-action="status" data-id="${quest.id}">
              ${statusOptions(quest.status)}
            </select>
          </label>
        </div>
        <p class="quest-summary">${escapeHtml(quest.summary)}</p>
        <p><strong>첫 행동:</strong> ${escapeHtml(quest.firstStep)}</p>
        <p><strong>완료 조건:</strong> ${escapeHtml(quest.doneWhen)}</p>
        <div class="step-progress" aria-label="체크리스트 진행도">
          <span>${checked}/${quest.steps.length} 체크</span>
          <div class="progress-track"><span style="width: ${progress}%"></span></div>
        </div>
        <ul class="checklist">
          ${quest.steps
            .map(
              (step) => `
                <li>
                  <label>
                    <input type="checkbox" data-action="step" data-quest-id="${quest.id}" data-step-id="${step.id}" ${step.completed ? "checked" : ""} />
                    <span>${escapeHtml(step.label)}</span>
                  </label>
                </li>`,
            )
            .join("")}
        </ul>
        <div class="quest-actions">
          <button class="button button-primary" type="button" data-action="complete" data-id="${quest.id}" ${complete ? "disabled" : ""}>완료</button>
          <button class="button button-secondary" type="button" data-action="progress" data-id="${quest.id}">진행 보고</button>
          <button class="button button-quiet" type="button" data-action="source" data-id="${quest.id}">근거 보기 · ${escapeHtml(source)}</button>
        </div>
      </div>
    </article>`;
}

function reportPanel(quest: Quest | undefined): string {
  if (!quest) {
    return `<aside class="report-panel empty"><p>보고할 퀘스트가 없습니다.</p></aside>`;
  }

  const question =
    quest.status === "completed"
      ? "완료로 표시된 결과가 맞나요?"
      : quest.status === "blocked"
        ? "무엇이 막혀 있는지와 필요한 도움을 알려주세요."
        : quest.status === "paused"
          ? "언제 다시 시작할 수 있을까요?"
          : `“${quest.title}”을(를) 오늘 어떻게 이어갈까요?`;

  return `
    <aside class="report-panel" aria-labelledby="report-title">
      <p class="eyebrow">CODEX CHECK-IN</p>
      <h2 id="report-title">진행 상황 보고</h2>
      <p class="report-question">${escapeHtml(question)}</p>
      <form id="report-form">
        <label>
          퀘스트
          <select name="questId" id="quest-select">
            ${board.quests
              .map(
                (item) =>
                  `<option value="${item.id}" ${item.id === quest.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label>
          상태
          <select name="status">${statusOptions(quest.status)}</select>
        </label>
        <label>
          진행 내용
          <textarea name="note" rows="3" maxlength="600" placeholder="예: 담당자에게 확인했고, 오후에 회신할 예정입니다."></textarea>
        </label>
        <label>
          다음 행동
          <input name="nextAction" maxlength="240" value="${escapeHtml(quest.firstStep)}" />
        </label>
        <button class="button button-primary button-full" type="submit">AIHUB에 진행 상황 남기기</button>
      </form>
      <p class="sync-note">${escapeHtml(syncMessage)}</p>
    </aside>`;
}

function render(): void {
  const quests = visibleQuests();
  const selected = selectedQuest();
  const completed = completedCount();
  const total = board.quests.length;
  const score = completedPoints();
  const maxScore = maximumPoints();
  const percentage = achievementPercent();

  app.innerHTML = `
    <main class="app-shell">
      <section class="hero" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">DAYBRIDGE · DAILY QUESTS</p>
          <h1 id="page-title">${escapeHtml(board.title)}</h1>
          <p class="hero-copy">${formatDate(board.activityDate)} · 업무일기의 모든 실행 항목을 퀘스트로 정리합니다.</p>
        </div>
        <div class="sync-indicator ${connection}">
          <span class="sync-dot"></span>
          ${connection === "connected" ? "AIHUB handoff 연결됨" : "로컬 미리보기"}
        </div>
      </section>

      <section class="achievement" aria-label="오늘의 달성도">
        <div class="achievement-copy">
          <p class="eyebrow">TODAY’S ACHIEVEMENT</p>
          <strong>${completed}/${total}</strong>
          <span>퀘스트 완료 · ${score}/${maxScore} XP</span>
        </div>
        <div class="achievement-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}">
          <span style="width: ${percentage}%"></span>
        </div>
        <p class="achievement-label">${percentage === 100 ? "오늘의 퀘스트를 모두 달성했습니다!" : `달성도 ${percentage}% · 작은 체크 하나도 다음 브리핑으로 이어집니다.`}</p>
      </section>

      <section class="workspace">
        <div class="quest-column">
          <div class="section-heading">
            <div>
              <p class="eyebrow">QUEST BOARD</p>
              <h2>오늘 해야 할 일 전체</h2>
            </div>
            <div class="filter-tabs" role="tablist" aria-label="퀘스트 필터">
              ${([
                ["all", "전체"],
                ["active", "진행"],
                ["completed", "완료"],
                ["paused", "보류"],
              ] as [QuestFilter, string][])
                .map(
                  ([value, label]) =>
                    `<button class="filter-tab ${filter === value ? "is-active" : ""}" type="button" data-filter="${value}" role="tab" aria-selected="${filter === value}">${label}</button>`,
                )
                .join("")}
            </div>
          </div>
          <p class="quest-count">${quests.length}개 표시 · 상태를 바꾸거나 체크리스트를 완료하면 바로 진행 기록으로 남습니다.</p>
          <div class="quest-list">
            ${quests.map(questCard).join("") || `<div class="empty-state">이 상태의 퀘스트가 없습니다.</div>`}
          </div>
        </div>
        ${reportPanel(selected)}
      </section>
    </main>`;
}

function updateQuest(questId: string, transform: (quest: Quest) => Quest): Quest | undefined {
  let updated: Quest | undefined;
  board = {
    ...board,
    quests: board.quests.map((quest) => {
      if (quest.id !== questId) {
        return quest;
      }
      updated = transform({
        ...quest,
        steps: quest.steps.map((step) => ({ ...step })),
        reports: [...quest.reports],
      });
      return updated;
    }),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch {
    // The bridge remains the durable path when browser storage is unavailable.
  }
  return updated;
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
        note: input.note.trim(),
        nextAction: input.nextAction.trim(),
        source: "daybridge" as const,
      },
    ].slice(-20),
  }));

  if (!quest) {
    return;
  }

  selectedQuestId = quest.id;
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
    if (!response.ok) {
      throw new Error("bridge unavailable");
    }
    const result = (await response.json()) as BridgeResponse;
    board = result.board;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    } catch {
      // Ignore storage failures; AIHUB already received the report.
    }
    connection = result.connection;
    syncMessage = "진행 보고가 AIHUB handoff 기록에 저장됐습니다. 퇴근·다음날 브리핑에서 이어집니다.";
  } catch {
    connection = "local";
    syncMessage = "브리지가 연결되지 않아 이 변경은 현재 화면에만 반영됐습니다.";
  }
  render();
}

async function loadConnectedBoard(): Promise<void> {
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    const response = await fetch(`${BRIDGE_URL}/api/board?date=${today}`);
    if (!response.ok) {
      return;
    }
    const result = (await response.json()) as BridgeResponse;
    board = result.board;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    } catch {
      // Ignore storage failures; the bridge remains the source of truth.
    }
    selectedQuestId = board.quests[0]?.id ?? "";
    connection = result.connection;
    syncMessage = "오늘의 퀘스트 보드를 불러왔습니다. 변경 내용은 user-reported handoff로 즉시 기록됩니다.";
    render();
  } catch {
    // The preview remains useful when a local bridge is intentionally absent.
  }
}

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const filterValue = target.dataset.filter as QuestFilter | undefined;
  if (filterValue) {
    filter = filterValue;
    render();
    return;
  }

  const action = target.dataset.action;
  const id = target.dataset.id;

  if (action === "complete" && id) {
    void sendReport({ questId: id, status: "completed", note: "Daybridge에서 완료로 표시함", nextAction: "" });
  }

  if (action === "progress" && id) {
    selectedQuestId = id;
    render();
    document.querySelector<HTMLTextAreaElement>('textarea[name="note"]')?.focus();
  }

  if (action === "source" && id) {
    const quest = board.quests.find((item) => item.id === id);
    if (quest) {
      syncMessage =
        quest.sourcePath === "demo://daily-note"
          ? "데모 데이터에는 원본 경로가 없습니다."
          : `근거: ${quest.sourceLabel} · ${quest.sourcePath}`;
      render();
    }
  }
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) {
    return;
  }

  if (target.dataset.action === "status") {
    const questId = target.dataset.id;
    if (questId) {
      void sendReport({
        questId,
        status: target.value as QuestStatus,
        note: "Daybridge에서 상태를 변경함",
        nextAction: "",
      });
    }
  }

  if (target.dataset.action === "step") {
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const questId = target.dataset.questId;
    const stepId = target.dataset.stepId;
    if (!questId || !stepId) {
      return;
    }
    const quest = board.quests.find((item) => item.id === questId);
    if (!quest) {
      return;
    }
    const steps: QuestStep[] = quest.steps.map((step) =>
      step.id === stepId ? { ...step, completed: target.checked } : step,
    );
    const allComplete = steps.length > 0 && steps.every((step) => step.completed);
    void sendReport({
      questId,
      status: allComplete ? "completed" : quest.status === "not_started" ? "in_progress" : quest.status,
      note: `체크리스트: ${steps.filter((step) => step.completed).length}/${steps.length} 완료`,
      nextAction: "",
      steps,
    });
  }

  if (target.id === "quest-select") {
    selectedQuestId = target.value;
    render();
  }
});

app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== "report-form") {
    return;
  }
  event.preventDefault();
  const values = new FormData(form);
  void sendReport({
    questId: String(values.get("questId") || ""),
    status: String(values.get("status")) as QuestStatus,
    note: String(values.get("note") || ""),
    nextAction: String(values.get("nextAction") || ""),
  });
});

render();
void loadConnectedBoard();
