import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { demoQuestBoard } from "./demo-data";

const BRIDGE_URL = "http://127.0.0.1:39393";
const STORAGE_KEY = "daybridge.quest-board.v3";
const AppContext = createContext(null);

function loadStoredBoard() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed.quests) && typeof parsed.activityDate === "string") return parsed;
    }
  } catch {
    // Demo board remains available when storage is unavailable.
  }
  return structuredClone(demoQuestBoard);
}

function persistBoard(board) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch {
    // The bridge is still attempted when browser storage is unavailable.
  }
}

function allStepsComplete(quest) {
  return quest.steps.length > 0 && quest.steps.every((step) => step.completed);
}

function currentKstDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function updateQuest(board, questId, transform) {
  return {
    ...board,
    quests: board.quests.map((quest) =>
      quest.id === questId
        ? transform({ ...quest, steps: quest.steps.map((step) => ({ ...step })), reports: [...quest.reports] })
        : quest,
    ),
  };
}

function reducer(state, action) {
  switch (action.type) {
    case "INIT":
      return { ...state, board: action.board, expandedQuestId: "" };
    case "TOGGLE_QUEST":
      return { ...state, expandedQuestId: state.expandedQuestId === action.questId ? "" : action.questId };
    case "ADD_QUEST": {
      const quest = action.quest;
      const board = { ...state.board, quests: [...state.board.quests, quest] };
      persistBoard(board);
      return { ...state, board };
    }
    case "UPDATE_BOARD":
      persistBoard(action.board);
      return { ...state, board: action.board };
    default:
      return state;
  }
}

export function useAppState() {
  return useContext(AppContext).state;
}

export function useAppActions() {
  return useContext(AppContext).actions;
}

export function useQuestGroups() {
  const { board } = useAppState();
  return useMemo(() => {
    const groups = { pending: [], paused: [], completed: [] };
    for (const quest of board.quests) {
      if (quest.status === "paused") groups.paused.push(quest);
      else if (quest.status === "completed") groups.completed.push(quest);
      else groups.pending.push(quest);
    }
    return groups;
  }, [board]);
}

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, { board: loadStoredBoard(), expandedQuestId: "" });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${BRIDGE_URL}/api/board?date=${currentKstDate()}`);
      if (!response.ok) return;
      const result = await response.json();
      dispatch({ type: "INIT", board: result.board });
      persistBoard(result.board);
    } catch {
      // Local board remains usable when the bridge is unavailable.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reportQuest = useCallback(async ({ questId, status, note, nextAction, steps }) => {
    let nextBoard;
    nextBoard = updateQuest(state.board, questId, (quest) => ({
      ...quest,
      status,
      steps: steps ? steps.map((step) => ({ ...step })) : quest.steps,
      updatedAt: new Date().toISOString(),
      reports: [
        ...quest.reports,
        {
          id: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          status,
          note,
          nextAction,
          source: "daybridge",
        },
      ].slice(-20),
    }));
    dispatch({ type: "UPDATE_BOARD", board: nextBoard });

    try {
      const response = await fetch(`${BRIDGE_URL}/api/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityDate: nextBoard.activityDate, questId, status, note, nextAction, steps: nextBoard.quests.find((quest) => quest.id === questId)?.steps ?? [] }),
      });
      if (!response.ok) return;
      const result = await response.json();
      dispatch({ type: "INIT", board: result.board });
      persistBoard(result.board);
    } catch {
      // Local receipt is retained until the next successful bridge refresh.
    }
  }, [state.board]);

  const actions = useMemo(() => ({
    toggleQuest: (questId) => dispatch({ type: "TOGGLE_QUEST", questId }),
    refresh,
    addQuest: (text) => {
      const clean = text.trim();
      if (!clean) return;
      const now = new Date().toISOString();
      const id = `manual-${crypto.randomUUID()}`;
      dispatch({
        type: "ADD_QUEST",
        quest: {
          id,
          title: clean,
          project: "Widget capture",
          category: "side",
          status: "not_started",
          summary: "Quickly captured from the Daybridge widget.",
          firstStep: clean,
          doneWhen: "The captured task is complete.",
          estimateMinutes: 15,
          points: 0,
          steps: [{ id: `${id}-step`, label: clean, completed: false }],
          sourceLabel: "Widget capture",
          sourcePath: "manual://widget",
          reports: [],
          updatedAt: now,
        },
      });
    },
    setQuestStatus: (quest, status) => {
      const steps = status === "completed"
        ? quest.steps.map((step) => ({ ...step, completed: true }))
        : status === "in_progress" && allStepsComplete(quest) && quest.steps.length > 0
          ? quest.steps.map((step, index) => ({ ...step, completed: index < quest.steps.length - 1 }))
          : quest.steps;
      void reportQuest({ questId: quest.id, status, steps, note: status === "completed" ? "Quest completed from widget" : "Quest paused from widget", nextAction: steps.find((step) => !step.completed)?.label ?? "" });
    },
    reportQuest,
  }), [refresh, reportQuest]);

  const value = useMemo(() => ({ state, actions, loading }), [actions, loading, state]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
