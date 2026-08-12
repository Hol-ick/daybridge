export type QuestStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "blocked"
  | "paused"
  | "needs_confirmation";

export type QuestFilter = "all" | "active" | "completed" | "paused";

export interface QuestStep {
  id: string;
  label: string;
  completed: boolean;
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
  title: string;
  project: string;
  category: "main" | "side";
  status: QuestStatus;
  summary: string;
  firstStep: string;
  doneWhen: string;
  estimateMinutes: number;
  points: number;
  steps: QuestStep[];
  sourceLabel: string;
  sourcePath: string;
  reports: QuestReport[];
  updatedAt?: string;
}

export interface QuestBoard {
  schemaVersion: 1;
  activityDate: string;
  sourceDate?: string;
  sourceInputs?: string[];
  title: string;
  generatedAt: string;
  sourceCoverage: "demo" | "connected" | "stale" | "attention";
  sourceQuality?: "aligned" | "attention" | "unknown";
  sourceWarnings?: string[];
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
