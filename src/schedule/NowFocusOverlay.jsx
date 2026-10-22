import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { closeOverlaySettingsModal, openDaybridgeDataDirectory, openOverlaySettingsModal, OVERLAY_COLLAPSED_HEIGHT, OVERLAY_EXPANDED_HEIGHT, setOverlayInteractionRegion, startOverlayDrag } from "../desktopWindow.js";
import { getWorkdayCountdown } from "./workday-clock.js";
import styles from "./NowFocusOverlay.module.css";
import ManualTaskForm from "./ManualTaskForm.jsx";
import DailyDefaultsEditor from "./DailyDefaultsEditor.jsx";
import { DEFAULT_MEALS } from "./settings-contract.js";
import { recordRuntimeEvent } from "../runtime-log.js";
import CloseButton from "../appearance/CloseButton.jsx";
import PalettePicker from "../appearance/PalettePicker.jsx";
import { loadRecoveryPreferences } from "../overlay-recovery/preferences.mjs";

/** @param {Date | string | number | undefined} value */
function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** @param {Date | string | number | undefined} value */
function formatTime(value) {
  const date = asDate(value);
  if (!date) return "";

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** @param {import("./ui-types").NowFocus | null | undefined} nowFocus */
function getFocusBlock(nowFocus) {
  if (!nowFocus) return null;
  if (Object.hasOwn(nowFocus, "block")) return nowFocus.block;
  if (Object.hasOwn(nowFocus, "focusBlock")) return nowFocus.focusBlock;
  return nowFocus;
}

/** @param {import("./ui-types").UiSchedule | null | undefined} schedule */
function getScheduleBlocks(schedule) {
  const direct = schedule?.blocks ?? schedule?.timeline ?? [];
  const focus = schedule?.focusBlocks ?? [];
  const busy = schedule?.busyBlocks ?? [];
  const buffer = schedule?.bufferBlocks ?? [];
  const blocks = direct.length ? direct : [...busy, ...focus, ...buffer];
  const listMode = schedule?.mode === "todo" || schedule?.timeConfigured === false;
  return [...blocks].filter((block) => !block?.hidden && scheduleBlockKind(block) !== "buffer").sort((left, right) => {
    if (listMode) return (left.order ?? 0) - (right.order ?? 0);
    const leftTime = asDate(left.startAt ?? left.start)?.getTime() ?? 0;
    const rightTime = asDate(right.startAt ?? right.start)?.getTime() ?? 0;
    return leftTime - rightTime;
  });
}

/** @param {Partial<import("./ui-types").UiBlock> | null | undefined} block */
function scheduleBlockKind(block) {
  const kind = block?.kind ?? block?.type ?? block?.blockType;
  if (kind === "busy" || kind === "calendar") return "busy";
  if (kind === "buffer" || kind === "break") return "buffer";
  return "focus";
}

/** @param {Partial<import("./ui-types").UiBlock> | null | undefined} block */
function scheduleBlockTitle(block) {
  const kind = scheduleBlockKind(block);
  if (kind === "busy") return "일정 중";
  if (kind === "buffer") return "여유 시간";
  return block?.displayTitle ?? block?.scheduleTitle ?? block?.questTitle ?? block?.taskTitle ?? block?.title ?? "집중 작업";
}

const BLOCK_STATUS_CYCLE = ["planned", "in_progress", "completed", "deferred"];
/** @type {Record<string, string>} */
const BLOCK_STATUS_LABELS = {
  planned: "미완료",
  in_progress: "진행 중",
  completed: "완료",
  deferred: "보류",
};

// The cards deliberately keep a stable touch target. The native overlay can
// therefore grow exactly around the visible list instead of reserving a large
// empty panel for a schedule that may only contain one or two tasks.
const OVERLAY_CARD_HEIGHT = 57;
const OVERLAY_CARD_GAP = 6;
const OVERLAY_PANEL_TOP_PADDING = 10;
const OVERLAY_TOOLBAR_HEIGHT = 60;
const OVERLAY_TOOLBAR_GAP = 6;
const OVERLAY_TRASH_HEIGHT = 57;
const OVERLAY_TRASH_GAP = 6;
const OVERLAY_EMPTY_LIST_HEIGHT = 62;
// The manual form lives in the footer flow (rather than covering the list),
// so reserve only the additional height it needs beyond the normal toolbar.
const OVERLAY_MANUAL_FORM_EXTRA_HEIGHT = 8;

/** @param {number} blockCount @param {boolean} [trashVisible] @param {boolean} [taskOpen] */
function expandedOverlayHeight(blockCount, trashVisible = false, taskOpen = false) {
  const listHeight = blockCount
    ? blockCount * OVERLAY_CARD_HEIGHT + Math.max(0, blockCount - 1) * OVERLAY_CARD_GAP
    : OVERLAY_EMPTY_LIST_HEIGHT;
  return Math.min(
    OVERLAY_EXPANDED_HEIGHT,
    OVERLAY_COLLAPSED_HEIGHT + OVERLAY_PANEL_TOP_PADDING + listHeight + OVERLAY_TOOLBAR_GAP + OVERLAY_TOOLBAR_HEIGHT
      + (trashVisible ? OVERLAY_TRASH_GAP + OVERLAY_TRASH_HEIGHT : 0)
      + (taskOpen ? OVERLAY_MANUAL_FORM_EXTRA_HEIGHT : 0),
  );
}

/** @param {string | undefined} status */
function blockStatusLabel(status) {
  return BLOCK_STATUS_LABELS[status || "planned"] || BLOCK_STATUS_LABELS.planned;
}

/** @param {string | undefined} status */
function nextBlockStatus(status) {
  const current = BLOCK_STATUS_CYCLE.indexOf(status || "");
  return BLOCK_STATUS_CYCLE[(current + 1 + BLOCK_STATUS_CYCLE.length) % BLOCK_STATUS_CYCLE.length];
}

/** @param {import("react").HTMLAttributes<HTMLElement>} props */
function OverlayTitle({ children, className = "", ...props }) {
  const viewportRef = useRef(/** @type {HTMLElement | null} */ (null));
  const trackRef = useRef(/** @type {HTMLSpanElement | null} */ (null));
  const [marqueeDistance, setMarqueeDistance] = useState(0);

  useEffect(() => {
    const measure = () => {
      const viewport = viewportRef.current;
      const track = trackRef.current;
      if (!viewport || !track) return;
      setMarqueeDistance(Math.max(0, Math.ceil(track.scrollWidth - viewport.clientWidth)));
    };
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (observer && viewportRef.current) observer.observe(viewportRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [children]);

  const moving = marqueeDistance > 0;
  return (
    <strong ref={viewportRef} className={[styles.title, className].filter(Boolean).join(" ")} {...props}>
      <span
        ref={trackRef}
        className={[styles.titleTrack, moving ? styles.titleTrackMoving : ""].filter(Boolean).join(" ")}
        style={moving ? { "--marquee-distance": `${marqueeDistance}px` } : undefined}
      >
        {children}
      </span>
    </strong>
  );
}

/** @param {import("./ui-types").ScheduleItemProps} props */
function OverlayScheduleItem({ block, privateMode, onMove, canDiscard = false, onStatusChange, onScheduleDragStart, onKeyboardMove, draggingBlockId, dropTargetId, dropPosition, swapRole, swapDirection, suppressClickRef }) {
  const kind = scheduleBlockKind(block);
  const status = block?.status;
  const actionable = kind === "focus" && status !== "completed" && status !== "deferred";
  const start = formatTime(block?.startAt ?? block?.start ?? block?.startTime);
  const title = privateMode && kind === "focus" ? "집중 시간" : scheduleBlockTitle(block);
  const label = start;
  // Untimed todo lists can reorder cards (without inventing times) and can
  // also send an open card to the discard target.
  const draggable = actionable && (typeof onMove === "function" || canDiscard);
  const clickable = kind === "focus" && typeof onStatusChange === "function";
  const handleKeyDown = (/** @type {import("react").KeyboardEvent<HTMLLIElement>} */ event) => {
    if (draggable && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      onKeyboardMove?.(block.id, event.key);
      return;
    }
    if (clickable && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      onStatusChange?.(block.id, nextBlockStatus(status));
    }
  };
  const handleClick = (/** @type {import("react").MouseEvent<HTMLLIElement>} */ event) => {
    if (!clickable) return;
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }
    onStatusChange?.(block.id, nextBlockStatus(status));
  };

  return (
    <li
      className={[styles.compactBlock, styles[kind], status === "completed" ? styles.completed : "", draggingBlockId === block?.id ? styles.dragging : "", dropTargetId === block?.id ? styles.dropTarget : "", dropTargetId === block?.id && dropPosition ? styles[`drop${dropPosition[0].toUpperCase()}${dropPosition.slice(1)}`] : "", swapRole === "source" ? styles.swapSource : "", swapRole === "target" ? styles.swapTarget : "", swapRole === "target" && swapDirection ? styles[`swapTarget${swapDirection[0].toUpperCase()}${swapDirection.slice(1)}`] : ""].filter(Boolean).join(" ")}
      data-testid={`now-focus-overlay-block-${block?.id ?? "unknown"}`}
      data-block-id={block?.id ?? ""}
      data-drag-enabled={draggable ? "true" : "false"}
      data-dragging={draggingBlockId === block?.id ? "true" : "false"}
      data-drop-target={dropTargetId === block?.id ? "true" : "false"}
      data-drop-position={dropTargetId === block?.id ? dropPosition || "" : ""}
      data-swap-role={swapRole || ""}
      data-status={status || "planned"}
      role={clickable ? "button" : undefined}
      aria-label={clickable ? `${title} · ${blockStatusLabel(status)} · 클릭하여 상태 변경` : title}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={handleKeyDown}
      onClick={clickable ? handleClick : undefined}
      onPointerDown={draggable ? (event) => onScheduleDragStart(event, block) : undefined}
      onMouseDown={draggable ? (event) => onScheduleDragStart(event, block) : undefined}
      data-tauri-drag-region="false"
    >
      <div className={styles.compactBlockTop}>
        {label ? <span className={styles.compactBlockTime}>{label}</span> : <span aria-hidden="true" />}
        {clickable ? <span className={styles.compactBlockStatus} data-testid={`now-focus-overlay-status-${block.id}`}>{blockStatusLabel(status)}</span> : null}
      </div>
      <OverlayTitle className={styles.compactBlockTitle} title={title} aria-label={title}>{title}</OverlayTitle>
    </li>
  );
}


/** @type {Record<import("./types").MealKey, string>} */
const MEAL_LABELS = { breakfast: "아침", lunch: "점심", dinner: "저녁" };

/** @param {import("./ui-types").SettingsProps} props */
export function OverlaySettingsModal({ privateMode, onClose, showCloseButton = true, onSubmit, onRefreshWidget, refreshingWidget, dailyDefaults, onDailyDefaultsChange, dailyDefaultsLoading, scheduleSettings, onScheduleSettingsChange, scheduleSettingsLoading, appearance, onAppearanceChange, storageDirectory, onStorageDirectoryChange, storageDirectoryLoading, notice = "" }) {
  /** @type {import("./ui-types").SettingsDraft} */
  const settings = scheduleSettings || { dayStart: "", dayEnd: "", timeConfigured: false, breaks: [], meals: DEFAULT_MEALS };
  const meals = settings.meals || { breakfast: {...DEFAULT_MEALS.breakfast, enabled: false}, lunch: {...DEFAULT_MEALS.lunch, enabled: false}, dinner: {...DEFAULT_MEALS.dinner, enabled: false} };
  const [activeTab, setActiveTab] = useState("schedule");
  const [privateDraft, setPrivateDraft] = useState(privateMode === true);
  useEffect(() => setPrivateDraft(privateMode === true), [privateMode]);
  const [recovery, setRecovery] = useState(/** @type {{enabled: boolean, delaySeconds: string} | null} */ (null));
  const [recoveryError, setRecoveryError] = useState("");
  useEffect(() => {
    let alive = true;
    void loadRecoveryPreferences().then(value => { if (alive) setRecovery({...value, delaySeconds: String(value.delaySeconds)}); })
      .catch(error => { if (alive) setRecoveryError(String(error)); });
    return () => { alive = false; };
  }, []);
  const [closing, setClosing] = useState(false);
  const requestClose = () => { if (closing) return; setClosing(true); window.setTimeout(() => onClose?.(), 180); };
  const updateSettings = (/** @type {Partial<import("./ui-types").SettingsDraft>} */ patch) => onScheduleSettingsChange?.({ ...settings, ...patch });
  const updateMeal = (/** @type {import("./types").MealKey} */ key, /** @type {Partial<import("./types").Meal>} */ patch) => {
    const nextMeals = { ...meals, [key]: { ...meals[key], ...patch } };
    updateSettings({ meals: nextMeals, breaks: Object.values(nextMeals).filter((item) => item.enabled).map(({ start, end, label }) => ({ start, end, label })) });
  };
  const timeConfigured = settings.timeConfigured === true;
  return (
    <div className={`${styles.settingsModal} ${closing ? styles.settingsModalClosing : ""}`} role="dialog" aria-modal={showCloseButton} aria-label="위젯 설정" data-testid="now-focus-overlay-settings-modal" data-tauri-drag-region="false">
      {notice ? <div className={styles.overlayToast} role="status" aria-live="polite" data-testid="daybridge-settings-toast">{notice}</div> : null}
      <form className={styles.settingsForm} onSubmit={onSubmit} data-testid="now-focus-overlay-settings-sheet">
        {recovery ? <><input type="hidden" name="overlayRecoveryEnabled" value={String(recovery.enabled)}/><input type="hidden" name="overlayRecoveryDelaySeconds" value={recovery.delaySeconds}/></> : null}
        <header className={styles.settingsHeader} data-tauri-drag-region="true">
          <div>
            <strong>설정</strong>
          </div>
          {showCloseButton ? <CloseButton label="설정 닫기" onClick={requestClose}/> : null}
        </header>
        {activeTab !== "display" ? <input type="hidden" name="privateOverlay" value={privateDraft ? "on" : ""} /> : null}
        <div className={styles.settingsLayout}>
          <nav className={styles.settingsNav} aria-label="설정 메뉴">
            <button type="button" className={activeTab === "schedule" ? styles.settingsNavActive : styles.settingsNavButton} aria-current={activeTab === "schedule" ? "page" : undefined} onClick={() => setActiveTab("schedule")}>시간표</button>
            <button type="button" className={activeTab === "display" ? styles.settingsNavActive : styles.settingsNavButton} aria-current={activeTab === "display" ? "page" : undefined} onClick={() => setActiveTab("display")}>화면</button>
            <button type="button" className={activeTab === "defaults" ? styles.settingsNavActive : styles.settingsNavButton} aria-current={activeTab === "defaults" ? "page" : undefined} onClick={() => setActiveTab("defaults")}>반복 일정</button>
          </nav>
          <main className={styles.settingsContent}>
            {activeTab === "schedule" ? <>
              <section className={styles.settingsSection} aria-label="근무 시간">
                <label className={styles.settingsCheckbox}>
                  <span><strong>시간표 사용</strong></span>
                  <input className={styles.settingsToggleInput} type="checkbox" checked={timeConfigured} onChange={(event) => updateSettings({ timeConfigured: event.target.checked, dayStart: event.target.checked ? (settings.dayStart || "09:00") : "", dayEnd: event.target.checked ? (settings.dayEnd || "18:00") : "" })} />
                  <span className={styles.settingsToggleTrack} aria-hidden="true" />
                </label>
                {timeConfigured ? <><div className={styles.settingsRow}>
                  <label className={styles.settingsField}><span>출근</span><input type="time" disabled={!timeConfigured} value={settings.dayStart ?? "09:00"} onChange={(event) => updateSettings({ dayStart: event.target.value })} /></label>
                  <label className={styles.settingsField}><span>퇴근</span><input type="time" disabled={!timeConfigured} value={settings.dayEnd ?? "18:00"} onChange={(event) => updateSettings({ dayEnd: event.target.value })} /></label>
                </div>
                <label className={`${styles.settingsField} ${styles.settingsInterval}`}><span>작업 사이 간격</span><span className={styles.intervalValue}><input type="number" min="0" max="30" step="1" value={settings.bufferMinutes ?? 10} onChange={(event) => updateSettings({ bufferMinutes: event.target.value })} disabled={scheduleSettingsLoading} /><span>분</span></span></label></> : null}
              </section>
              <section className={styles.settingsSection} aria-label="식사 시간">
                <span className={styles.settingsSectionLabel}>식사 시간</span>
                {!settings.meals && settings.breaks?.length ? <span className="memo-sr-only">휴식: {settings.breaks.map(item => `${item.label} ${item.start}–${item.end}`).join(", ")}</span> : null}
                {(/** @type {import("./types").MealKey[]} */ (Object.keys(DEFAULT_MEALS))).map((key) => <div className={styles.mealSettingRow} key={key}>
                  <label className={styles.settingsCheckbox}><span><strong>{MEAL_LABELS[key]}</strong></span><input className={styles.settingsToggleInput} type="checkbox" checked={meals[key].enabled === true} onChange={(event) => updateMeal(key, { enabled: event.target.checked })} /><span className={styles.settingsToggleTrack} aria-hidden="true" /></label>
                  {meals[key].enabled ? <div className={styles.settingsRow}><label className={styles.settingsField}><span>시작</span><input type="time" value={meals[key].start ?? DEFAULT_MEALS[key].start} onChange={(event) => updateMeal(key, { start: event.target.value })} /></label><label className={styles.settingsField}><span>종료</span><input type="time" value={meals[key].end ?? DEFAULT_MEALS[key].end} onChange={(event) => updateMeal(key, { end: event.target.value })} /></label></div> : null}
                </div>)}
              </section>
            </> : null}
            {activeTab === "display" ? <>
              <section className={styles.settingsSection} aria-label="표시 옵션"><label className={styles.settingsCheckbox}><span><strong>위젯에서 작업명 숨기기</strong></span><input className={styles.settingsToggleInput} name="privateOverlay" type="checkbox" checked={privateDraft} onChange={event=>setPrivateDraft(event.target.checked)} /><span className={styles.settingsToggleTrack} aria-hidden="true" /></label></section>
              <section className={styles.settingsSection} aria-label="위젯 자동 복구">
                {recovery ? <><label className={styles.settingsCheckbox}><span><strong>자동 전면 복구</strong></span><input className={styles.settingsToggleInput} type="checkbox" checked={recovery.enabled} onChange={event=>setRecovery({...recovery,enabled:event.target.checked})}/><span className={styles.settingsToggleTrack} aria-hidden="true"/></label>
                  <label className={`${styles.settingsField} ${styles.settingsInterval}`}><span>복구 대기</span><span className={styles.intervalValue}><input type="number" min="1" max="300" step="1" required value={recovery.delaySeconds} onChange={event=>setRecovery({...recovery,delaySeconds:event.target.value})}/><span>초</span></span></label></> : null}
                {recoveryError ? <span role="alert">{recoveryError}</span> : null}
              </section>
              <section className={styles.settingsSection} aria-label="색상 테마"><span className={styles.settingsSectionLabel}>앱 색상</span><PalettePicker appearance={appearance} onChange={onAppearanceChange}/></section>
            </> : null}
            {activeTab === "defaults" ? <>
              <DailyDefaultsEditor value={dailyDefaults} onChange={onDailyDefaultsChange} loading={dailyDefaultsLoading} />
              <details className={styles.storageDetails}><summary>저장 폴더</summary><label className={styles.settingsField}><span>경로</span><input type="text" aria-label="일정·설정·활동 로그 경로" value={storageDirectory || ""} onChange={(event) => onStorageDirectoryChange?.(event.target.value)} disabled={storageDirectoryLoading} /></label></details>
            </> : null}
          </main>
        </div>
        <footer className={styles.settingsFooter}><div className={styles.settingsUtilityRow}>
        <button
          className={styles.settingsUtility}
          type="button"
          onClick={onRefreshWidget}
          disabled={refreshingWidget || !onRefreshWidget}
          data-testid="now-focus-overlay-refresh"
          data-tauri-drag-region="false"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 11a8.1 8.1 0 0 0-14.2-4.4L4 8.5M4 4v4.5h4.5M4 13a8.1 8.1 0 0 0 14.2 4.4l1.8-1.9M20 20v-4.5h-4.5" /></svg>
          <span>{refreshingWidget ? "새로고침 중…" : "위젯 새로고침"}</span>
        </button>
        <button className={styles.settingsUtility} type="button" onClick={() => { void openDaybridgeDataDirectory(storageDirectory).catch(() => {}); }} data-testid="now-focus-overlay-open-data" data-tauri-drag-region="false">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3.5 6.5h6l2 2h9v10.5h-17zM3.5 6.5v-2h6l2 2" /></svg>
          <span>저장 폴더 열기</span>
        </button>
        </div>
        <button className={styles.settingsSave} type="submit" disabled={dailyDefaultsLoading || scheduleSettingsLoading}>저장</button>
        </footer>
      </form>
    </div>
  );
}

/**
 * A deliberately quiet, always-visible surface for the desktop corner.
 * It owns no timer or state: the host decides which block is current.
 */
/** @param {import("./ui-types").OverlayProps} props */
export default function NowFocusOverlay({ schedule, nowFocus, onReportBlock, onAddManualTask, onMoveBlock, onDiscardBlock, settingsOpen = false, archiveOpen = false, onCloseMemoArchive, onOpenSettings, onOpenMemoArchive, onCloseSettings, onSaveSettings, onRefreshWidget, refreshingWidget = false, privateMode = false, dailyDefaults = [], onDailyDefaultsChange, dailyDefaultsLoading = false, scheduleSettings = {}, onScheduleSettingsChange, scheduleSettingsLoading = false, appearance = {}, onAppearanceChange, notice = "", storageDirectory = "", onStorageDirectoryChange, storageDirectoryLoading = false, magnetPulse = false }) {
  const modalOpen = settingsOpen;
  const dragRef = useRef(/** @type {{point: {x: number, y: number} | null, inputType: string | null, cleanup: (() => void) | null, suppressClick: boolean}} */ ({ point: null, inputType: null, cleanup: null, suppressClick: false }));
  const pointerDragRef = useRef(/** @type {import("./ui-types").PointerDragState} */ ({ blockId: "", block: null, element: null, inputType: null, pointerId: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0, width: 0, height: 0, started: false, cleanup: null }));
  const suppressCardClickRef = useRef(false);
  const collapsePendingRef = useRef(false);
  const settingsWasOpenRef = useRef(false);
  const swapTimerRef = useRef(/** @type {number | null} */ (null));
  const flipRectsRef = useRef(/** @type {Map<string, DOMRect>} */ (new Map()));
  const flipAnimationsRef = useRef(/** @type {Set<Animation>} */ (new Set()));
  const flipReadyRef = useRef(false);
  const [draggingBlockId, setDraggingBlockId] = useState("");
  const [dropTargetId, setDropTargetId] = useState("");
  const [dropPosition, setDropPosition] = useState("");
  const [dragPreview, setDragPreview] = useState(/** @type {import("./ui-types").DragPreview | null} */ (null));
  const [trashActive, setTrashActive] = useState(false);
  const [swapState, setSwapState] = useState(/** @type {{sourceId: string, targetId: string, direction: string} | null} */ (null));
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskResetSignal, setTaskResetSignal] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const skipNextExpandedRegionSyncRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => () => {
    if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
    flipAnimationsRef.current.forEach((animation) => animation.cancel());
    flipAnimationsRef.current.clear();
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const block = getFocusBlock(nowFocus);
  const blocks = useMemo(() => getScheduleBlocks(schedule), [schedule]);
  const todoListMode = schedule?.mode === "todo" || schedule?.timeConfigured === false;
  const blockKind = block?.kind ?? block?.type ?? block?.blockType;
  const isBusy = blockKind === "busy" || blockKind === "calendar";
  const sourceTitle = isBusy ? (block?.hidden ? block?.title ?? "점심시간" : "일정 중") : block?.displayTitle ?? block?.scheduleTitle ?? block?.questTitle ?? block?.taskTitle ?? block?.title ?? "다음 집중 시간 준비 중";
  const title = privateMode && block ? "집중 시간" : sourceTitle;
  const idle = !block;
  const showIdleTitle = idle || todoListMode;
  const start = formatTime(block?.startAt ?? block?.start ?? block?.startTime);
  const end = formatTime(block?.endAt ?? block?.end ?? block?.endTime);
  const timeLabel = start && end ? `${start} — ${end}` : start || end || "";
  const workdayCountdown = getWorkdayCountdown(currentTime);
  // In untimed todo mode the user's active work takes precedence over list
  // order. Completed history stays in the expanded list, but it must never be
  // promoted back into the compact widget as if it were the current task.
  const todoSummaryBlock = blocks.find((item) => scheduleBlockKind(item) === "focus" && item?.status === "in_progress")
    ?? blocks.find((item) => scheduleBlockKind(item) === "focus" && !["completed", "deferred", "skipped"].includes(item?.status || ""));
  const summaryTitle = todoListMode
    ? (todoSummaryBlock ? scheduleBlockTitle(todoSummaryBlock) : "남은 일정이 없습니다.")
    : idle ? workdayCountdown.label : title;
  const targetExpandedHeight = expandedOverlayHeight(blocks.length, Boolean(draggingBlockId), taskOpen);
  // The list only becomes scrollable after the native overlay has reached its
  // maximum height. Short schedules grow around every visible card instead.
  const listCanScroll = targetExpandedHeight >= OVERLAY_EXPANDED_HEIGHT;

  useLayoutEffect(() => {
    const nextRects = new Map();
    const nodes = document.querySelectorAll('[data-testid^="now-focus-overlay-block-"]');
    if (!expanded) {
      nodes.forEach((node) => {
        const id = node.getAttribute("data-block-id");
        if (id) nextRects.set(id, node.getBoundingClientRect());
      });
      flipRectsRef.current = nextRects;
      flipReadyRef.current = false;
      return;
    }
    if (!flipReadyRef.current) {
      nodes.forEach((node) => {
        const id = node.getAttribute("data-block-id");
        if (id) nextRects.set(id, node.getBoundingClientRect());
      });
      flipRectsRef.current = nextRects;
      flipReadyRef.current = true;
      return;
    }
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    nodes.forEach((node) => {
      const id = node.getAttribute("data-block-id");
      if (!id) return;
      const next = node.getBoundingClientRect();
      const previous = flipRectsRef.current.get(id);
      if (previous && !reducedMotion && typeof node.animate === "function") {
        const deltaX = previous.left - next.left;
        const deltaY = previous.top - next.top;
        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
          const animation = node.animate(
            [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: "translate(0, 0)" }],
            { duration: 460, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both" },
          );
          flipAnimationsRef.current.add(animation);
          animation.finished.catch(() => {}).finally(() => flipAnimationsRef.current.delete(animation));
        }
      }
      nextRects.set(id, next);
    });
    flipRectsRef.current = nextRects;
  }, [blocks, expanded]);

  useLayoutEffect(() => {
    const wasSettingsOpen = settingsWasOpenRef.current;
    settingsWasOpenRef.current = modalOpen;
    if (modalOpen) {
      // A dialog must never share the corner card's collapsing viewport. The
      // native window moves to the screen centre while the underlying card is
      // made inert, so a blur cannot leave a 64px-tall clipped form behind.
      collapsePendingRef.current = false;
      if (taskOpen) {
        setTaskOpen(false);
        setTaskResetSignal((value) => value + 1);
      }
      if (expanded) setExpanded(false);
      void openOverlaySettingsModal().catch((error) => {
        recordRuntimeEvent("settings_modal_open_error", { error: error?.message || String(error) });
        if (archiveOpen) onCloseMemoArchive?.(); else onCloseSettings?.();
        return false;
      });
      return;
    }
    if (wasSettingsOpen) {
      void closeOverlaySettingsModal().catch((error) => {
        recordRuntimeEvent("settings_modal_close_error", { error: error?.message || String(error) });
        return false;
      });
    }
  }, [onCloseSettings, modalOpen]);

  const movableBlocks = useMemo(() => blocks.filter((item) => scheduleBlockKind(item) === "focus" && !["completed", "deferred", "skipped"].includes(item?.status || "")), [blocks]);
  const findDropTarget = (/** @type {number} */ clientX, /** @type {number} */ clientY, sourceId = "") => {
    const element = document.elementFromPoint(clientX, clientY);
    const node = element instanceof Element ? element : null;
    const trash = node?.closest('[data-testid="now-focus-overlay-trash"]');
    if (trash) return { card: null, trash, targetId: "" };

    // A narrow exact-card hit area made a perfectly reasonable release in the
    // 6px gap between cards cancel the move. Resolve the entire vertical lane
    // to the nearest *other* open card instead, with a small gutter on every
    // card. The visible before/after rail still describes the exact placement.
    const cards = movableBlocks
      .filter((item) => item.id !== sourceId)
      .map((item) => {
        const card = document.querySelector(`[data-block-id="${CSS.escape(item.id)}"]`);
        return card instanceof HTMLElement ? { card, id: item.id, rect: card.getBoundingClientRect() } : null;
      })
      .filter(item => item !== null);
    const directCard = node?.closest("[data-block-id]");
    const directId = directCard?.getAttribute("data-block-id") || "";
    if (directCard instanceof HTMLElement && directId !== sourceId && cards.some((item) => item.id === directId)) {
      return { card: directCard, trash: null, targetId: directId };
    }
    const horizontalMatch = cards.some(({ rect }) => clientX >= rect.left - 12 && clientX <= rect.right + 12);
    const candidates = horizontalMatch
      ? cards.filter(({ rect }) => clientY >= rect.top - 12 && clientY <= rect.bottom + 12)
      : [];
    if (!candidates.length) return { card: null, trash: null, targetId: "" };
    const nearest = candidates.reduce((best, item) => {
      const bestDistance = Math.abs(clientY - (best.rect.top + best.rect.height / 2));
      const itemDistance = Math.abs(clientY - (item.rect.top + item.rect.height / 2));
      return itemDistance < bestDistance ? item : best;
    });
    return { card: nearest.card, trash: null, targetId: nearest.id };
  };
  const clearPointerDrag = () => {
    pointerDragRef.current.cleanup?.();
    pointerDragRef.current = { blockId: "", block: null, element: null, inputType: null, pointerId: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0, width: 0, height: 0, started: false, cleanup: null };
    setDraggingBlockId("");
    setDropTargetId("");
    setDropPosition("");
    setDragPreview(null);
    setTrashActive(false);
  };
  const updateDragPreview = (/** @type {import("./ui-types").NativeDragEvent} */ event, /** @type {import("./ui-types").PointerDragState} */ state) => {
    const surface = document.querySelector('[data-testid="now-focus-overlay-surface"]');
    const surfaceRect = surface?.getBoundingClientRect();
    if (!surfaceRect || !state.block) return;
    setDragPreview({
      block: state.block,
      left: event.clientX - surfaceRect.left - state.offsetX,
      top: event.clientY - surfaceRect.top - state.offsetY,
      width: state.width,
      height: state.height,
    });
  };
  const handleScheduleDragMove = (/** @type {import("./ui-types").NativeDragEvent} */ event) => {
    const state = pointerDragRef.current;
    const inputType = event.type.startsWith("pointer") ? "pointer" : "mouse";
    if (!state.blockId || state.inputType !== inputType || (inputType === "pointer" && state.pointerId !== event.pointerId)) return;
    if (inputType === "mouse" && event.buttons === 0) return;
    const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
    if (!state.started && distance < 6) return;
    if (!state.started) {
      state.started = true;
      suppressCardClickRef.current = true;
      setDraggingBlockId(state.blockId);
    }
    event.preventDefault();
    event.stopPropagation();
    updateDragPreview(event, state);
    const target = findDropTarget(event.clientX, event.clientY, state.blockId);
    if (target.trash) {
      setTrashActive(true);
      setDropTargetId("");
      setDropPosition("");
      return;
    }
    setTrashActive(false);
    setDropTargetId(target.targetId && target.targetId !== state.blockId ? target.targetId : "");
    const targetRect = target.card?.getBoundingClientRect();
    const nextPosition = target.targetId && target.targetId !== state.blockId && targetRect
      ? (event.clientY < targetRect.top + (targetRect.height / 2) ? "before" : "after")
      : "";
    setDropPosition(nextPosition);
  };
  const handleScheduleDragEnd = async (/** @type {import("./ui-types").NativeDragEvent} */ event) => {
    const state = pointerDragRef.current;
    const inputType = event.type.startsWith("pointer") ? "pointer" : "mouse";
    if (!state.blockId || state.inputType !== inputType || (inputType === "pointer" && state.pointerId !== event.pointerId)) return;
    event.stopPropagation();
    const sourceId = state.blockId;
    const target = findDropTarget(event.clientX, event.clientY, sourceId);
    const targetItem = movableBlocks.find((item) => item.id === target.targetId && item.id !== sourceId);
    const rect = target.card?.getBoundingClientRect();
    const position = rect && event.clientY < rect.top + (rect.height / 2) ? "before" : "after";
    const shouldMove = state.started && Boolean(targetItem && onMoveBlock);
    const shouldDiscard = state.started && Boolean(target.trash && onDiscardBlock);
    if (state.started) suppressCardClickRef.current = true;
    if (shouldMove && targetItem) {
      if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
      setSwapState({ sourceId, targetId: targetItem.id, direction: position });
      swapTimerRef.current = window.setTimeout(() => setSwapState(null), 460);
    }
    clearPointerDrag();
    if (shouldDiscard) await onDiscardBlock?.(sourceId);
    else if (shouldMove && targetItem) await onMoveBlock?.(sourceId, targetItem.id, position);
    window.setTimeout(() => { suppressCardClickRef.current = false; }, 0);
  };
  const handleScheduleDragStart = (/** @type {import("./ui-types").DragEvent} */ event, /** @type {import("./ui-types").UiBlock} */ item) => {
    if ((!onMoveBlock && !onDiscardBlock) || event.button !== 0 || pointerDragRef.current.blockId) return;
    const inputType = event.type.startsWith("pointer") ? "pointer" : "mouse";
    event.stopPropagation();
    event.preventDefault();
    suppressCardClickRef.current = false;
    try { if (inputType === "pointer" && typeof event.pointerId === "number") event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* pointer capture is optional */ }
    const moveEvent = inputType === "pointer" ? "pointermove" : "mousemove";
    const endEvent = inputType === "pointer" ? "pointerup" : "mouseup";
    const cancelEvent = inputType === "pointer" ? "pointercancel" : "mouseleave";
    const element = event.currentTarget instanceof Element ? event.currentTarget : null;
    const rect = element?.getBoundingClientRect();
    const move = (/** @type {import("./ui-types").NativeDragEvent} */ moveEventValue) => handleScheduleDragMove(moveEventValue);
    const end = (/** @type {import("./ui-types").NativeDragEvent} */ endEventValue) => handleScheduleDragEnd(endEventValue);
    document.addEventListener(moveEvent, move, { passive: false });
    document.addEventListener(endEvent, end, { once: true });
    document.addEventListener(cancelEvent, end, { once: true });
    pointerDragRef.current = {
      blockId: item.id,
      block: item,
      element,
      inputType,
      pointerId: inputType === "pointer" ? event.pointerId ?? null : null,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: rect ? event.clientX - rect.left : 0,
      offsetY: rect ? event.clientY - rect.top : 0,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
      started: false,
      cleanup: () => {
        document.removeEventListener(moveEvent, move);
        document.removeEventListener(endEvent, end);
        document.removeEventListener(cancelEvent, end);
      },
    };
  };
  const handleKeyboardMove = async (/** @type {string} */ sourceId, /** @type {string} */ key) => {
    const index = movableBlocks.findIndex((item) => item.id === sourceId);
    if (index < 0) return;
    const target = movableBlocks[index + (key === "ArrowUp" ? -1 : 1)];
    if (!target || !onMoveBlock) return;
    await onMoveBlock(sourceId, target.id, key === "ArrowUp" ? "before" : "after");
  };

  const finishCollapse = () => {
    if (!collapsePendingRef.current || modalOpen) return;
    collapsePendingRef.current = false;
    void setOverlayInteractionRegion({ height: OVERLAY_COLLAPSED_HEIGHT }).catch(() => false);
  };

  const setExpandedMode = (/** @type {boolean} */ next) => {
    if (modalOpen) {
      if (!next) {
        if (archiveOpen) onCloseMemoArchive?.(); else onCloseSettings?.();
      }
      return;
    }
    if (next) {
      collapsePendingRef.current = false;
      // The native canvas stays fixed. Expand only its clickable/visible
      // region first, then let the card's CSS pull its top edge upward.
      void setOverlayInteractionRegion({ height: targetExpandedHeight })
        .then(() => { skipNextExpandedRegionSyncRef.current = true; })
        .catch(() => { skipNextExpandedRegionSyncRef.current = false; })
        .finally(() => setExpanded(true));
    } else {
      if (taskOpen) {
        setTaskOpen(false);
        setTaskResetSignal((value) => value + 1);
      }
      collapsePendingRef.current = true;
      setExpanded(false);
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        window.requestAnimationFrame(finishCollapse);
      }
    }
  };

  useEffect(() => {
    if (!expanded || modalOpen) return undefined;
    if (skipNextExpandedRegionSyncRef.current) {
      skipNextExpandedRegionSyncRef.current = false;
      return undefined;
    }
    void setOverlayInteractionRegion({ height: targetExpandedHeight });
    return undefined;
  }, [expanded, modalOpen, targetExpandedHeight]);

  useEffect(() => {
    if (!expanded || modalOpen || archiveOpen) return undefined;
    const collapse = () => setExpandedMode(false);
    const handleWindowBlur = () => collapse();
    const handleOutsidePointer = (/** @type {PointerEvent} */ event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('[data-testid="now-focus-overlay-surface"]')) collapse();
    };
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
    };
  }, [expanded, modalOpen, archiveOpen, taskOpen]);

  const handlePointerDown = (/** @type {import("./ui-types").DragEvent} */ event) => {
    if (dragRef.current.point) return;
    window.getSelection?.()?.removeAllRanges();
    const target = event.target instanceof Element ? event.target : null;
    const openButton = target?.closest('[data-testid="now-focus-overlay-open"]');
    const interactive = target?.closest('[data-tauri-drag-region="false"]');
    if (event.button !== 0 || (interactive && !openButton)) return;
    const state = dragRef.current;
    const inputType = event.type.startsWith("pointer") ? "pointer" : "mouse";
    state.point = { x: event.clientX, y: event.clientY };
    state.inputType = inputType;
    event.preventDefault();
    const moveEvent = inputType === "pointer" ? "pointermove" : "mousemove";
    const endEvent = inputType === "pointer" ? "pointerup" : "mouseup";
    const cancelEvent = inputType === "pointer" ? "pointercancel" : "mouseleave";
    const cleanup = () => {
      document.removeEventListener(moveEvent, handleMove);
      document.removeEventListener(endEvent, cleanup);
      document.removeEventListener(cancelEvent, cleanup);
      state.point = null;
      state.inputType = null;
      state.cleanup = null;
    };
    const handleMove = (/** @type {MouseEvent} */ moveEvent) => {
      if (!state.point || Math.hypot(moveEvent.clientX - state.point.x, moveEvent.clientY - state.point.y) < 4) return;
      cleanup();
      state.suppressClick = true;
      // A title-button click stays a normal click. Start native dragging only
      // after movement so the dashboard action cannot be swallowed by Tauri.
      void startOverlayDrag().catch(() => { state.suppressClick = false; });
      window.setTimeout(() => { state.suppressClick = false; }, 500);
    };
    state.cleanup?.();
    state.cleanup = cleanup;
    document.addEventListener(moveEvent, handleMove, { passive: false });
    document.addEventListener(endEvent, cleanup, { once: true });
    document.addEventListener(cancelEvent, cleanup, { once: true });
    if (!openButton) {
      // Non-interactive card padding can start dragging immediately. Buttons
      // wait for the movement threshold above so ordinary clicks remain live.
      void startOverlayDrag().catch(() => { state.suppressClick = false; });
    }
  };

  const handleToggleExpanded = (/** @type {import("react").MouseEvent<HTMLButtonElement>} */ event) => {
    if (dragRef.current.suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      dragRef.current.suppressClick = false;
      return;
    }
    setExpandedMode(!expanded);
  };

  const handleSurfaceTransitionEnd = (/** @type {import("react").TransitionEvent<HTMLDivElement>} */ event) => {
    if (event.target !== event.currentTarget || event.propertyName !== "height") return;
    finishCollapse();
  };

  const surfaceClassName = [styles.surface, expanded ? styles.expanded : "", modalOpen ? styles.settingsMode : "", taskOpen ? styles.taskOpen : "", magnetPulse ? styles.magnetPulse : ""].filter(Boolean).join(" ");

  return (
    <aside className={styles.overlay} aria-label="Daybridge 현재 할 일" data-testid="now-focus-overlay">
      {!modalOpen && notice ? <div className={styles.overlayToast} role="status" aria-live="polite" data-testid="daybridge-toast">{notice}</div> : null}
      <div
        className={surfaceClassName}
        style={{ "--overlay-expanded-height": `${targetExpandedHeight}px` }}
        onPointerDown={handlePointerDown}
        onMouseDown={handlePointerDown}
        onTransitionEnd={handleSurfaceTransitionEnd}
        data-testid="now-focus-overlay-surface"
        data-expanded-height={targetExpandedHeight}
        aria-hidden={modalOpen ? "true" : undefined}
      >
        <section className={styles.expandedPanel} aria-label={todoListMode ? "오늘 할 일 목록" : "오늘 시간표 관리"} aria-hidden={!expanded} data-tauri-drag-region="false" data-testid="now-focus-overlay-expanded">
          {blocks.length ? (
            <ol className={styles.compactList} data-scrollable={listCanScroll ? "true" : "false"}>
              {blocks.map((item) => (
                <OverlayScheduleItem
                  key={item.id ?? `${item.startAt}-${scheduleBlockTitle(item)}`}
                  block={item}
                  privateMode={privateMode}
                  onMove={onMoveBlock}
                  canDiscard={typeof onDiscardBlock === "function"}
                  onStatusChange={onReportBlock}
                  onScheduleDragStart={handleScheduleDragStart}
                  onKeyboardMove={handleKeyboardMove}
                  draggingBlockId={draggingBlockId}
                  dropTargetId={dropTargetId}
                  dropPosition={dropPosition}
                  swapRole={swapState?.sourceId === item.id ? "source" : swapState?.targetId === item.id ? "target" : ""}
                  swapDirection={swapState?.targetId === item.id ? swapState.direction : ""}
                  suppressClickRef={suppressCardClickRef}
                />
              ))}
            </ol>
          ) : <span className="memo-sr-only">{todoListMode ? "오늘 할 일이 없습니다." : "오늘 배치된 일정이 없습니다."}</span>}
          {dragPreview ? (
            <div
              className={[styles.compactBlock, styles.focus, styles.dragPreview].join(" ")}
              data-testid="now-focus-overlay-drag-preview"
              aria-hidden="true"
              style={{ left: `${dragPreview.left}px`, top: `${dragPreview.top}px`, width: `${dragPreview.width}px`, height: `${dragPreview.height}px` }}
            >
              <div className={styles.compactBlockTop}>
                <span className={styles.compactBlockTime}>{formatTime(dragPreview.block?.startAt ?? dragPreview.block?.start ?? dragPreview.block?.startTime)}</span>
                <span className={styles.dragPreviewHint}>이동 중</span>
              </div>
              <OverlayTitle className={styles.compactBlockTitle}>{privateMode ? "집중 시간" : scheduleBlockTitle(dragPreview.block)}</OverlayTitle>
            </div>
          ) : null}
          <footer className={styles.expandedFooter} aria-label="시간표 도구">
            <div className={styles.manualTaskFooter}><ManualTaskForm compact iconOnly resetSignal={taskResetSignal} onOpenChange={setTaskOpen} onSubmit={onAddManualTask} /></div>
            <button type="button" className={styles.iconAction} onClick={onOpenMemoArchive} data-testid="now-focus-overlay-memo-archive" data-tauri-drag-region="false" aria-label="메모 보관함" title="메모 보관함">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5h16v4H4zM5 9v11h14V9M9 13h6" /></svg>
            </button>
            <button type="button" className={styles.iconAction} onClick={onOpenSettings} disabled={!onOpenSettings} data-tauri-drag-region="false" data-testid="now-focus-overlay-settings" aria-label="시간표 설정">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.8 3.7 10.4 2h3.2l.6 1.7 1.6.9 1.7-.5 2.2 2.2-.5 1.7.9 1.6 1.7.6v3.2l-1.7.6-.9 1.6.5 1.7-2.2 2.2-1.7-.5-1.6.9-.6 1.7h-3.2l-.6-1.7-1.6-.9-1.7.5-2.2-2.2.5-1.7-.9-1.6-1.7-.6v-3.2l1.7-.6.9-1.6-.5-1.7 2.2-2.2 1.7.5 1.6-.9Z" /><circle cx="12" cy="12" r="3.1" /></svg>
            </button>
          </footer>
          {draggingBlockId ? (
            <div
              className={[styles.trashZone, trashActive ? styles.trashActive : ""].filter(Boolean).join(" ")}
              data-testid="now-focus-overlay-trash"
              data-trash-active={trashActive ? "true" : "false"}
              aria-label={trashActive ? "놓으면 작업 폐기" : "작업을 폐기하려면 여기로 끌기"}
              style={dragPreview ? { height: `${dragPreview.height}px` } : undefined}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 7h14M9 7V5h6v2m-8 3v7m4-7v7m4-7v7M7 7l1 13h8l1-13" />
              </svg>
              <span>{trashActive ? "놓으면 폐기" : "여기로 폐기"}</span>
            </div>
          ) : null}
        </section>
        <div className={styles.summary} data-testid="now-focus-overlay-summary">
        <button
          className={styles.open}
          type="button"
          onClick={handleToggleExpanded}
          data-tauri-drag-region="false"
          data-testid="now-focus-overlay-open"
          aria-label={expanded ? "시간표 접기" : "오늘 시간표 펼치기"}
          aria-expanded={expanded}
        >
          {timeLabel ? (
            <span className={styles.meta}>
              <span className={styles.time} data-testid="now-focus-overlay-time">{timeLabel}</span>
            </span>
          ) : null}
          {showIdleTitle && summaryTitle ? (
            <OverlayTitle
              data-testid="now-focus-overlay-title"
              aria-label={todoListMode ? (todoSummaryBlock ? `오늘 할 일: ${summaryTitle}` : summaryTitle) : `${workdayCountdown.label} ${workdayCountdown.time}`}
            >{summaryTitle}</OverlayTitle>
          ) : !showIdleTitle ? (
            <OverlayTitle data-testid="now-focus-overlay-title">{title}</OverlayTitle>
          ) : null}
        </button>
        <button
          className={styles.timer}
          type="button"
          onClick={handleToggleExpanded}
          data-tauri-drag-region="false"
          data-testid="now-focus-overlay-leave-time"
          aria-label={`${workdayCountdown.label} ${workdayCountdown.time}`}
          aria-expanded={expanded}
        >
          <span className={styles.timerLabel}>{workdayCountdown.label}</span>
          <strong className={styles.timerValue} data-testid="now-focus-overlay-leave-time-value">{workdayCountdown.time}</strong>
        </button>
        </div>
      </div>
      {settingsOpen ? <OverlaySettingsModal privateMode={privateMode} onClose={onCloseSettings} onSubmit={onSaveSettings} onRefreshWidget={onRefreshWidget} refreshingWidget={refreshingWidget} dailyDefaults={dailyDefaults} onDailyDefaultsChange={onDailyDefaultsChange} dailyDefaultsLoading={dailyDefaultsLoading} scheduleSettings={scheduleSettings} onScheduleSettingsChange={onScheduleSettingsChange} scheduleSettingsLoading={scheduleSettingsLoading} appearance={appearance} onAppearanceChange={onAppearanceChange} storageDirectory={storageDirectory} onStorageDirectoryChange={onStorageDirectoryChange} storageDirectoryLoading={storageDirectoryLoading} notice={notice} /> : null}
    </aside>
  );
}
