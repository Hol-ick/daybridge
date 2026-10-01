import type { Quest, QuestBoard, QuestStatus, QuestStep, ProgressReportInput } from "./types";

export interface UiStep extends QuestStep { depends_on?: string[] }
export interface UiQuest extends Omit<Quest, "state" | "steps"> {
  state: QuestStatus;
  steps: UiStep[];
  depends_on?: string[];
}
export interface UiBoard extends Omit<QuestBoard, "quests"> { quests: UiQuest[] }
export type QuestInput = Partial<UiQuest> & {id: string; title: string};
export interface AppState { board: UiBoard; expandedQuestId: string }
export type AppAction =
  | {type: "INIT" | "SYNC" | "UPDATE_BOARD"; board: UiBoard}
  | {type: "TOGGLE_QUEST"; questId: string}
  | {type: "ADD_QUEST"; quest: UiQuest};
export interface AppActions {
  toggleQuest(questId: string): void;
  refresh(options?: {announce?: boolean}): Promise<boolean>;
  addQuest(text: string): void;
  setQuestStatus(quest: UiQuest, status: QuestStatus): void;
  deferQuest(quest: UiQuest): void;
  reportQuest(input: ProgressReportInput): Promise<void>;
}
export interface AppContextValue { state: AppState; actions: AppActions; loading: boolean; notice: string }
