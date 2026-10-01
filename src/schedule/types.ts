import type { QuestPriority, QuestState } from "../types";

export interface BreakRange { start: string; end: string; label: string }
export type MealKey = "breakfast" | "lunch" | "dinner";
export interface Meal extends BreakRange { enabled: boolean }
export interface ScheduleSettings {
  schemaVersion: 1;
  timeZone: "Asia/Seoul";
  dayStart: string;
  dayEnd: string;
  timeConfigured: boolean;
  focusDurations: readonly number[];
  defaultFocusMinutes: number;
  bufferMinutes: number;
  breaks: readonly BreakRange[];
  meals?: Record<MealKey, Meal>;
}
export interface ScheduleSettingsInput {
  dayStart?: string;
  dayEnd?: string;
  timeConfigured?: boolean;
  bufferMinutes?: number | string;
  breaks?: readonly Partial<BreakRange>[];
  meals?: Partial<Record<MealKey, Partial<Meal>>>;
}
export interface TaskCandidate {
  id: string;
  title: string;
  priority: QuestPriority;
  state: QuestState;
  estimateMinutes: number;
  remainingMinutes: number;
  dependsOn: string[];
  completedDependencies?: string[];
  execution: "independent" | "sequential";
  sourceKind: "routine" | "session" | "briefing";
  category: string | null;
  sourceRefs: string[];
  sourcePath?: string;
  sourceLabel?: string;
  carryoverCount?: number;
  carryoverSourceDate?: string;
}
export interface TaskCandidateInput extends Partial<Omit<TaskCandidate, "state" | "priority" | "estimateMinutes" | "remainingMinutes">> {
  state?: string;
  status?: string;
  priority?: string;
  estimateMinutes?: number | string;
  remainingMinutes?: number | string;
  scheduleTitle?: string;
  displayTitle?: string;
  focusUnits?: number | string;
  focus_units?: number | string;
  remainingUnits?: number | string;
  remaining_units?: number | string;
}
export interface ScheduleBlock {
  id: string;
  type: "focus" | "busy" | "buffer";
  questId?: string;
  taskId?: string;
  startAt?: string;
  endAt?: string;
  title?: string;
  label?: string;
  status?: "planned" | "in_progress" | "completed" | "skipped" | "deferred";
  locked?: boolean;
  hidden?: boolean;
  timed?: boolean;
  order?: number;
  workMinutes?: number;
  taskMetadata?: TaskCandidate;
  priority?: QuestPriority;
  sourceKind?: TaskCandidate["sourceKind"];
  category?: string | null;
  sourceIds?: string[];
  userPositioned?: boolean;
  updatedAt?: string;
  reports?: Array<{ id: string; status: string; occurredAt: string }>;
}
export interface TimedBlock extends ScheduleBlock { startAt: string; endAt: string }
export interface UnscheduledTask { questId: string; reason: string; remainingMinutes: number; taskMetadata?: TaskCandidate }
export interface DailySchedule {
  schemaVersion: 1;
  date: string;
  timezone: "Asia/Seoul";
  generatedAt: string;
  mode?: "todo" | "timed";
  timeConfigured?: boolean;
  blocks: ScheduleBlock[];
  unscheduled: UnscheduledTask[];
}
export interface Routine {
  id: string;
  title: string;
  estimateMinutes: number;
  durationMinutes?: number;
  days: readonly number[];
  enabled?: boolean;
  category?: string;
}
export interface CarryoverCandidate extends TaskCandidateInput {
  title: string;
  state: "ready" | "in_progress" | "deferred";
  remainingMinutes: number;
  carryoverCount?: number;
}
export interface InboxTask extends TaskCandidateInput {
  questId: string;
  durationMinutes: number;
  currentAction: string;
  firstStep: string;
  doneWhen: string | null;
}
export interface InboxResult {
  valid: boolean;
  date: string | null;
  timezone: string | null;
  updatedAt: string | null;
  tasks: InboxTask[];
  excluded: Array<{row: number, id?: string | null, reason: string}>;
  warnings: string[];
  errors: string[];
}
export interface ScheduleInput extends Partial<DailySchedule> { date?: string }
export interface ScheduleBuildInput {
  date?: string;
  settings?: ScheduleSettingsInput;
  taskCandidates?: TaskCandidateInput[];
  busyBlocks?: ScheduleBlock[];
  lockedBlocks?: ScheduleBlock[];
  completedQuestIds?: string[];
  startAt?: string;
  generatedAt?: string;
}
