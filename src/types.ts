export type QuestState = "ready" | "in_progress" | "deferred" | "blocked" | "completed";
export type QuestStatus = QuestState | "not_started" | "paused" | "needs_confirmation";
export type QuestPriority = "must" | "should" | "could";
export type QuestKind = "execute" | "review" | "decision";
export type QuestExecution = "independent" | "sequential";

export interface QuestStep {
  id: string;
  label: string;
  completed: boolean;
  order?: number;
  dependsOn?: string[];
}

export interface QuestReport {
  id: string;
  occurredAt: string;
  status: QuestStatus;
  note: string;
  nextAction: string;
  source: "daybridge";
}

export interface Quest {
  id: string;
  missionId?: string;
  title: string;
  project: string;
  priority: QuestPriority;
  kind: QuestKind;
  execution: QuestExecution;
  dependsOn: string[];
  state: QuestState;
  status: QuestStatus;
  summary: string;
  firstStep: string;
  currentAction?: string;
  doneWhen: string;
  scheduleTitle?: string;
  focusUnits?: number;
  remainingUnits?: number;
  estimateMinutes: number;
  remainingMinutes?: number;
  progress: { completed: number; total: number };
  carryoverCount: number;
  steps: QuestStep[];
  sourceLabel: string;
  sourcePath: string;
  sourceRefs?: string[];
  reports: QuestReport[];
  updatedAt?: string;
}

export interface Mission {
  id: string;
  title: string;
  project?: string;
  progress: { completed: number; total: number };
}

export interface QuestBoard {
  schemaVersion: 2;
  activityDate: string;
  sourceDate?: string;
  sourceInputs?: string[];
  title: string;
  generatedAt: string;
  sourceCoverage: "demo" | "connected" | "stale" | "attention";
  sourceQuality?: "aligned" | "attention" | "unknown";
  sourceWarnings?: string[];
  sourceMetadata?: Record<string, unknown>;
  excluded?: Array<{ title: string; reason: string; sourceRefs?: string[] }>;
  reviewQueue?: Array<{ id: string; question: string; reason: string; sourceRefs?: string[] }>;
  missions?: Mission[];
  quests: Quest[];
}

export interface ProgressReportInput {
  questId: string;
  status: QuestStatus;
  note: string;
  nextAction: string;
  steps?: QuestStep[];
}

export interface BridgeResponse {
  board: QuestBoard;
  connection: "connected" | "local";
  eventRecorded?: boolean;
}
