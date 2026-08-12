import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { demoQuestBoard } from "./demo-data";

const BRIDGE_URL = "http://127.0.0.1:39393";
const STORAGE_KEY = "daybridge.quest-board.v4";
const AppContext = createContext(null);

function normalizeQuest(quest) {
  const steps = Array.isArray(quest.steps) ? quest.steps.map((step, index) => ({ ...step, order: step.order ?? index + 1, dependsOn: step.dependsOn ?? step.depends_on ?? [] })) : [];
  const state = quest.state || (quest.status === "paused" ? "deferred" : quest.status === "not_started" ? "ready" : quest.status) || "ready";
  return { priority: "should", kind: "execute", execution: "independent", dependsOn: [], carryoverCount: 0, reports: [], ...quest, state, status: state, steps, progress: { completed: steps.filter((step) => step.completed).length, total: steps.length } };
}

function normalizeBoard(board) {
  if (!board || !Array.isArray(board.quests)) return structuredClone(demoQuestBoard);
  const quests = board.quests.map(normalizeQuest);
  return { schemaVersion: 2, ...board, missions: board.missions || [], quests };
}

function loadStoredBoard() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeBoard(JSON.parse(stored));
  } catch { /* demo board remains available */ }
  return normalizeBoard(structuredClone(demoQuestBoard));
}

function persistBoard(board) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(board)); } catch { /* bridge remains usable */ } }
function currentKstDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()); }
function updateQuest(board, questId, transform) { return { ...board, quests: board.quests.map((quest) => quest.id === questId ? transform(normalizeQuest({ ...quest, steps: quest.steps.map((step) => ({ ...step })), reports: [...(quest.reports || [])] })) : quest) }; }
function progressFor(steps) { return { completed: steps.filter((step) => step.completed).length, total: steps.length }; }

function reducer(state, action) {
  switch (action.type) {
    case "INIT": return { ...state, board: normalizeBoard(action.board), expandedQuestId: "" };
    case "TOGGLE_QUEST": return { ...state, expandedQuestId: state.expandedQuestId === action.questId ? "" : action.questId };
    case "ADD_QUEST": { const board = normalizeBoard({ ...state.board, quests: [...state.board.quests, action.quest] }); persistBoard(board); return { ...state, board }; }
    case "UPDATE_BOARD": persistBoard(action.board); return { ...state, board: normalizeBoard(action.board) };
    default: return state;
  }
}

export function useAppState() { return useContext(AppContext).state; }
export function useAppActions() { return useContext(AppContext).actions; }

export function useQuestGroups() {
  const { board } = useAppState();
  return useMemo(() => {
    const groups = { now: [], next: [], waiting: [], completed: [] };
    for (const quest of board.quests) {
      if (quest.state === "completed") groups.completed.push(quest);
      else if (["blocked", "deferred"].includes(quest.state)) groups.waiting.push(quest);
      else if (quest.state === "in_progress" || quest.priority === "must") groups.now.push(quest);
      else groups.next.push(quest);
    }
    return groups;
  }, [board]);
}

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, { board: loadStoredBoard(), expandedQuestId: "" });
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${BRIDGE_URL}/api/board?date=${currentKstDate()}`);
      if (!response.ok) return;
      const result = await response.json();
      dispatch({ type: "INIT", board: result.board });
      persistBoard(result.board);
    } catch { /* local board remains usable */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const reportQuest = useCallback(async ({ questId, status, note, nextAction, steps }) => {
    const nextBoard = updateQuest(state.board, questId, (quest) => {
      const nextSteps = steps ? steps.map((step) => ({ ...step })) : quest.steps;
      const nextState = status === "not_started" ? "ready" : status === "paused" ? "deferred" : status;
      return { ...quest, state: nextState, status, steps: nextSteps, progress: progressFor(nextSteps), currentAction: nextAction || quest.currentAction, updatedAt: new Date().toISOString(), reports: [...quest.reports, { id: crypto.randomUUID(), occurredAt: new Date().toISOString(), status, note, nextAction, source: "daybridge" }].slice(-20) };
    });
    dispatch({ type: "UPDATE_BOARD", board: nextBoard });
    const quest = nextBoard.quests.find((item) => item.id === questId);
    try {
      const response = await fetch(`${BRIDGE_URL}/api/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: nextBoard.activityDate, questId, status, note, nextAction, steps: quest?.steps ?? [], missionId: quest?.missionId, state: quest?.state }) });
      if (!response.ok) return;
      const result = await response.json(); dispatch({ type: "INIT", board: result.board }); persistBoard(result.board);
    } catch { /* receipt remains local */ }
  }, [state.board]);

  const actions = useMemo(() => ({
    toggleQuest: (questId) => dispatch({ type: "TOGGLE_QUEST", questId }),
    refresh,
    addQuest: (text) => { const clean = text.trim(); if (!clean) return; const id = `manual-${crypto.randomUUID()}`; dispatch({ type: "ADD_QUEST", quest: normalizeQuest({ id, title: clean, project: "Widget capture", priority: "could", kind: "execute", execution: "independent", state: "ready", status: "ready", summary: "Captured from the Daybridge widget.", firstStep: clean, currentAction: clean, doneWhen: "The captured task is complete.", estimateMinutes: 15, missionId: `mission-${id}`, steps: [{ id: `${id}-step`, label: clean, completed: false }], sourceLabel: "Widget capture", sourcePath: "manual://widget" }) }); },
    setQuestStatus: (quest, status) => { const steps = status === "completed" ? quest.steps.map((step) => ({ ...step, completed: true })) : quest.steps; void reportQuest({ questId: quest.id, status, steps, note: status === "completed" ? "Quest completed from widget" : status === "deferred" ? "Quest deferred to tomorrow" : "Quest resumed from widget", nextAction: steps.find((step) => !step.completed)?.label ?? "" }); },
    deferQuest: (quest) => { void reportQuest({ questId: quest.id, status: "deferred", note: "Quest deferred to tomorrow", nextAction: quest.currentAction || quest.firstStep, steps: quest.steps }); },
    reportQuest,
  }), [refresh, reportQuest]);

  const value = useMemo(() => ({ state, actions, loading }), [actions, loading, state]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
