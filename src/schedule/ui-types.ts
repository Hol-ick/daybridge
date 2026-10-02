import type { CSSProperties, MouseEvent, SubmitEvent } from "react";
import type { DailySchedule, Meal, Routine, ScheduleBlock, ScheduleSettingsInput } from "./types";

declare module "react" {
  interface CSSProperties { [property: `--${string}`]: string | number | undefined }
}
export interface UiBlock extends ScheduleBlock {
  kind?: string;
  blockType?: string;
  start?: string;
  end?: string;
  startTime?: string;
  endTime?: string;
  displayTitle?: string;
  scheduleTitle?: string;
  questTitle?: string;
  taskTitle?: string;
}
export interface UiSchedule extends Omit<DailySchedule, "blocks"> {
  blocks: UiBlock[];
  timeline?: UiBlock[];
  focusBlocks?: UiBlock[];
  busyBlocks?: UiBlock[];
  bufferBlocks?: UiBlock[];
  unscheduledCount?: number;
  label?: string;
  dateLabel?: string;
  calendar?: { coverage?: string };
}
export interface NowFocus extends Partial<UiBlock> {
  state?: string;
  block?: UiBlock | null;
  focusBlock?: UiBlock | null;
  nextFocus?: UiBlock | null;
  blockId?: string;
}
export type Appearance = {accent?: string};
export type SettingsDraft = Omit<ScheduleSettingsInput, "meals"> & {meals?: Record<"breakfast" | "lunch" | "dinner", Meal>};
export type MoveBlock = (blockId: string, targetId: string, position: "before" | "after") => unknown | Promise<unknown>;
export type ReportBlock = (blockId: string, status: string) => unknown | Promise<unknown>;
export type AddManualTask = (input: {title: string}) => unknown | Promise<unknown>;
export interface SettingsProps {
  privateMode?: boolean;
  onClose?: () => void;
  onSubmit?: (event: SubmitEvent<HTMLFormElement>) => void | Promise<void>;
  onRefreshWidget?: () => void | Promise<void>;
  refreshingWidget?: boolean;
  dailyDefaults?: Routine[];
  onDailyDefaultsChange?: (routines: Routine[]) => void;
  dailyDefaultsLoading?: boolean;
  scheduleSettings?: SettingsDraft;
  onScheduleSettingsChange?: (settings: SettingsDraft) => void;
  scheduleSettingsLoading?: boolean;
  appearance?: Appearance;
  onAppearanceChange?: (appearance: Appearance) => void;
  storageDirectory?: string;
  onStorageDirectoryChange?: (directory: string) => void;
  storageDirectoryLoading?: boolean;
  notice?: string;
}
export interface OverlayProps extends Omit<SettingsProps, "onClose" | "onSubmit"> {
  schedule?: UiSchedule | null;
  nowFocus?: NowFocus | null;
  onReportBlock?: ReportBlock;
  onAddManualTask?: AddManualTask;
  onMoveBlock?: MoveBlock;
  onDiscardBlock?: (blockId: string) => unknown | Promise<unknown>;
  settingsOpen?: boolean;
  onOpenSettings?: () => void;
  onOpenMemoArchive?: () => void;
  onCloseSettings?: () => void;
  onSaveSettings?: SettingsProps["onSubmit"];
  magnetPulse?: boolean;
}
export type DragEvent = MouseEvent<HTMLElement> & {pointerId?: number};
export type NativeDragEvent = globalThis.MouseEvent & {pointerId?: number};
export interface PointerDragState {
  blockId: string;
  block: UiBlock | null;
  element: Element | null;
  inputType: "pointer" | "mouse" | null;
  pointerId: number | null;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  started: boolean;
  cleanup: (() => void) | null;
}
export interface DragPreview {block: UiBlock; left: number; top: number; width: number; height: number}
export interface ScheduleItemProps {
  block: UiBlock;
  privateMode: boolean;
  onMove?: MoveBlock;
  canDiscard?: boolean;
  onStatusChange?: ReportBlock;
  onScheduleDragStart: (event: DragEvent, block: UiBlock) => void;
  onKeyboardMove?: (id: string, key: string) => Promise<void>;
  draggingBlockId: string;
  dropTargetId: string;
  dropPosition: string;
  swapRole: string;
  swapDirection: string;
  suppressClickRef: {current: boolean};
}
export type UiStyle = CSSProperties;
