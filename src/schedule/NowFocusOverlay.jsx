import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { OVERLAY_COLLAPSED_HEIGHT, OVERLAY_COLLAPSED_WIDTH, OVERLAY_EXPANDED_HEIGHT, OVERLAY_MODAL_WIDTH, resizeOverlay, startOverlayDrag } from "../desktopWindow.js";
import { getWorkdayCountdown } from "./workday-clock.js";
import styles from "./NowFocusOverlay.module.css";
import ManualTaskForm from "./ManualTaskForm.jsx";

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value) {
  const date = asDate(value);
  if (!date) return "";

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getFocusBlock(nowFocus) {
  if (!nowFocus) return null;
  if (Object.hasOwn(nowFocus, "block")) return nowFocus.block;
  if (Object.hasOwn(nowFocus, "focusBlock")) return nowFocus.focusBlock;
  return nowFocus;
}

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

function scheduleBlockKind(block) {
  const kind = block?.kind ?? block?.type ?? block?.blockType;
  if (kind === "busy" || kind === "calendar") return "busy";
  if (kind === "buffer" || kind === "break") return "buffer";
  return "focus";
}

function scheduleBlockTitle(block) {
  const kind = scheduleBlockKind(block);
  if (kind === "busy") return "일정 중";
  if (kind === "buffer") return "여유 시간";
  return block?.displayTitle ?? block?.scheduleTitle ?? block?.questTitle ?? block?.taskTitle ?? block?.title ?? "집중 작업";
}

const BLOCK_STATUS_CYCLE = ["planned", "in_progress", "completed", "deferred"];
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
const OVERLAY_EMPTY_LIST_HEIGHT = 62;

function expandedOverlayHeight(blockCount, settingsOpen) {
  if (settingsOpen) return OVERLAY_EXPANDED_HEIGHT;
  const listHeight = blockCount
    ? blockCount * OVERLAY_CARD_HEIGHT + Math.max(0, blockCount - 1) * OVERLAY_CARD_GAP
    : OVERLAY_EMPTY_LIST_HEIGHT;
  return Math.min(
    OVERLAY_EXPANDED_HEIGHT,
    OVERLAY_COLLAPSED_HEIGHT + OVERLAY_PANEL_TOP_PADDING + listHeight + OVERLAY_TOOLBAR_GAP + OVERLAY_TOOLBAR_HEIGHT,
  );
}

function blockStatusLabel(status) {
  return BLOCK_STATUS_LABELS[status] || BLOCK_STATUS_LABELS.planned;
}

function nextBlockStatus(status) {
  const current = BLOCK_STATUS_CYCLE.indexOf(status);
  return BLOCK_STATUS_CYCLE[(current + 1 + BLOCK_STATUS_CYCLE.length) % BLOCK_STATUS_CYCLE.length];
}

function OverlayTitle({ children, className = "", ...props }) {
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
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
  const handleKeyDown = (event) => {
    if (draggable && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      onKeyboardMove?.(block.id, event.key);
      return;
    }
    if (clickable && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      onStatusChange(block.id, nextBlockStatus(status));
    }
  };
  const handleClick = (event) => {
    if (!clickable) return;
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }
    onStatusChange(block.id, nextBlockStatus(status));
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

function OverlaySettingsModal({ settings, privateMode, onClose, onSubmit, onRefreshWidget, refreshingWidget }) {
  if (!settings) {
    return <div className={styles.settingsModal} role="dialog" aria-modal="true" aria-label="시간표 설정"><div className={styles.settingsLoading}>설정을 불러오는 중…</div></div>;
  }

  return (
    <div className={styles.settingsModal} role="dialog" aria-modal="true" aria-label="시간표 설정" data-testid="now-focus-overlay-settings-modal" data-tauri-drag-region="false">
      <form className={styles.settingsForm} onSubmit={onSubmit}>
        <header className={styles.settingsHeader}>
          <div><span>시간표 설정</span><strong>오늘의 리듬</strong></div>
          <button type="button" className={styles.settingsClose} onClick={onClose} aria-label="설정 닫기" data-tauri-drag-region="false">×</button>
        </header>
        <div className={styles.settingsRow}>
          <label>시작 시간<input name="dayStart" type="time" defaultValue={settings.dayStart} /></label>
          <label>마감 시간<input name="dayEnd" type="time" defaultValue={settings.dayEnd} /></label>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.fixedSetting}><span>집중 단위</span><strong>00–50분</strong></div>
          <label>완충 시간<select name="bufferMinutes" defaultValue={String(settings.bufferMinutes)}><option value="0">없음</option><option value="5">5분</option><option value="10">10분</option><option value="15">15분</option></select></label>
        </div>
        <label className={styles.settingsCheckbox}><input name="privateOverlay" type="checkbox" defaultChecked={privateMode} /><span>오버레이에서 작업명 숨기기</span></label>
        <button
          className={styles.settingsUtility}
          type="button"
          onClick={onRefreshWidget}
          disabled={refreshingWidget || !onRefreshWidget}
          data-testid="now-focus-overlay-refresh"
          data-tauri-drag-region="false"
        >
          {refreshingWidget ? "새로고침 중…" : "위젯 새로고침"}
        </button>
        <button className={styles.settingsSave} type="submit">저장하고 재배치</button>
      </form>
    </div>
  );
}

/**
 * A deliberately quiet, always-visible surface for the desktop corner.
 * It owns no timer or state: the host decides which block is current.
 */
export default function NowFocusOverlay({ schedule, nowFocus, onReportBlock, onAddManualTask, onMoveBlock, onDiscardBlock, settings, settingsOpen = false, onOpenSettings, onCloseSettings, onSaveSettings, onRefreshWidget, refreshingWidget = false, privateMode = false }) {
  const dragRef = useRef({ point: null, inputType: null, cleanup: null, suppressClick: false });
  const pointerDragRef = useRef({ blockId: "", block: null, element: null, inputType: null, pointerId: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0, width: 0, height: 0, started: false, cleanup: null });
  const suppressCardClickRef = useRef(false);
  const resizeTimerRef = useRef(null);
  const swapTimerRef = useRef(null);
  const flipRectsRef = useRef(new Map());
  const flipAnimationsRef = useRef(new Set());
  const flipReadyRef = useRef(false);
  const [draggingBlockId, setDraggingBlockId] = useState("");
  const [dropTargetId, setDropTargetId] = useState("");
  const [dropPosition, setDropPosition] = useState("");
  const [dragPreview, setDragPreview] = useState(null);
  const [trashActive, setTrashActive] = useState(false);
  const [swapState, setSwapState] = useState(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskResetSignal, setTaskResetSignal] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => () => {
    if (resizeTimerRef.current) window.clearTimeout(resizeTimerRef.current);
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
  // order. If nothing is active yet, keep the first actionable item as the
  // gentle next-step prompt.
  const todoSummaryBlock = blocks.find((item) => scheduleBlockKind(item) === "focus" && item?.status === "in_progress")
    ?? blocks.find((item) => scheduleBlockKind(item) === "focus" && !["completed", "deferred", "skipped"].includes(item?.status))
    ?? blocks[0];
  const summaryTitle = todoListMode ? (todoSummaryBlock ? scheduleBlockTitle(todoSummaryBlock) : "오늘 할 일") : idle ? workdayCountdown.label : title;
  const targetExpandedHeight = expandedOverlayHeight(blocks.length, settingsOpen);
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

  const movableBlocks = useMemo(() => blocks.filter((item) => scheduleBlockKind(item) === "focus" && !["completed", "deferred", "skipped"].includes(item?.status)), [blocks]);
  const findDropTarget = (clientX, clientY, sourceId = "") => {
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
      .filter(Boolean);
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
  const updateDragPreview = (event, state) => {
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
  const handleScheduleDragMove = (event) => {
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
  const handleScheduleDragEnd = async (event) => {
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
    if (shouldMove) {
      if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
      setSwapState({ sourceId, targetId: targetItem.id, direction: position });
      swapTimerRef.current = window.setTimeout(() => setSwapState(null), 460);
    }
    clearPointerDrag();
    if (shouldDiscard) await onDiscardBlock(sourceId);
    else if (shouldMove) await onMoveBlock(sourceId, targetItem.id, position);
    window.setTimeout(() => { suppressCardClickRef.current = false; }, 0);
  };
  const handleScheduleDragStart = (event, item) => {
    if ((!onMoveBlock && !onDiscardBlock) || event.button !== 0 || pointerDragRef.current.blockId) return;
    const inputType = event.type.startsWith("pointer") ? "pointer" : "mouse";
    event.stopPropagation();
    event.preventDefault();
    suppressCardClickRef.current = false;
    try { if (inputType === "pointer") event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* pointer capture is optional */ }
    const moveEvent = inputType === "pointer" ? "pointermove" : "mousemove";
    const endEvent = inputType === "pointer" ? "pointerup" : "mouseup";
    const cancelEvent = inputType === "pointer" ? "pointercancel" : "mouseleave";
    const element = event.currentTarget instanceof Element ? event.currentTarget : null;
    const rect = element?.getBoundingClientRect();
    const move = (moveEventValue) => handleScheduleDragMove(moveEventValue);
    const end = (endEventValue) => handleScheduleDragEnd(endEventValue);
    document.addEventListener(moveEvent, move, { passive: false });
    document.addEventListener(endEvent, end, { once: true });
    document.addEventListener(cancelEvent, end, { once: true });
    pointerDragRef.current = {
      blockId: item.id,
      block: item,
      element,
      inputType,
      pointerId: inputType === "pointer" ? event.pointerId : null,
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
  const handleKeyboardMove = async (sourceId, key) => {
    const index = movableBlocks.findIndex((item) => item.id === sourceId);
    if (index < 0) return;
    const target = movableBlocks[index + (key === "ArrowUp" ? -1 : 1)];
    if (!target || !onMoveBlock) return;
    await onMoveBlock(sourceId, target.id, key === "ArrowUp" ? "before" : "after");
  };

  const setExpandedMode = (next) => {
    if (resizeTimerRef.current) window.clearTimeout(resizeTimerRef.current);
    if (next) {
      // Grow the native viewport first. The collapsed card is already aligned
      // to that viewport's bottom, so the CSS height animation can then pull
      // only its top edge upward without moving the summary row.
      void resizeOverlay(targetExpandedHeight, settingsOpen ? OVERLAY_MODAL_WIDTH : OVERLAY_COLLAPSED_WIDTH).catch(() => false).finally(() => setExpanded(true));
    } else {
      if (taskOpen) {
        setTaskOpen(false);
        setTaskResetSignal((value) => value + 1);
      }
      setExpanded(false);
      resizeTimerRef.current = window.setTimeout(() => {
        void resizeOverlay(OVERLAY_COLLAPSED_HEIGHT, settingsOpen ? OVERLAY_MODAL_WIDTH : OVERLAY_COLLAPSED_WIDTH);
      }, 280);
    }
  };

  useEffect(() => {
    if (!expanded) return undefined;
    void resizeOverlay(targetExpandedHeight, settingsOpen ? OVERLAY_MODAL_WIDTH : OVERLAY_COLLAPSED_WIDTH);
    return undefined;
  }, [expanded, settingsOpen, targetExpandedHeight]);

  useEffect(() => {
    if (!expanded) return undefined;
    const collapse = () => setExpandedMode(false);
    const handleWindowBlur = () => collapse();
    const handleOutsidePointer = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('[data-testid="now-focus-overlay-surface"]')) collapse();
    };
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
    };
  }, [expanded, settingsOpen, taskOpen]);

  const handlePointerDown = (event) => {
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
    const handleMove = (moveEvent) => {
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

  const handleToggleExpanded = (event) => {
    if (dragRef.current.suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      dragRef.current.suppressClick = false;
      return;
    }
    setExpandedMode(!expanded);
  };

  const surfaceClassName = [styles.surface, expanded ? styles.expanded : "", settingsOpen ? styles.settingsOpen : "", taskOpen ? styles.taskOpen : ""].filter(Boolean).join(" ");

  return (
    <aside className={[styles.overlay, settingsOpen ? styles.settingsOpen : ""].filter(Boolean).join(" ")} aria-label="Daybridge 현재 할 일" data-testid="now-focus-overlay">
      <div
        className={surfaceClassName}
        style={{ "--overlay-expanded-height": `${targetExpandedHeight}px` }}
        onPointerDown={handlePointerDown}
        onMouseDown={handlePointerDown}
        data-testid="now-focus-overlay-surface"
        data-expanded-height={targetExpandedHeight}
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
          ) : <p className={styles.compactEmpty}>{todoListMode ? "오늘 할 일이 없습니다." : "오늘 배치된 일정이 없습니다."}</p>}
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
            <button type="button" className={styles.iconAction} onClick={onOpenSettings} disabled={!onOpenSettings} data-tauri-drag-region="false" data-testid="now-focus-overlay-settings" aria-label="시간표 설정">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.8 3.7 10.4 2h3.2l.6 1.7 1.6.9 1.7-.5 2.2 2.2-.5 1.7.9 1.6 1.7.6v3.2l-1.7.6-.9 1.6.5 1.7-2.2 2.2-1.7-.5-1.6.9-.6 1.7h-3.2l-.6-1.7-1.6-.9-1.7.5-2.2-2.2.5-1.7-.9-1.6-1.7-.6v-3.2l1.7-.6.9-1.6-.5-1.7 2.2-2.2 1.7.5 1.6-.9Z" /><circle cx="12" cy="12" r="3.1" /></svg>
            </button>
          </footer>
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
          {showIdleTitle ? (
            <OverlayTitle
              data-testid="now-focus-overlay-title"
              aria-label={todoListMode ? (todoSummaryBlock ? `오늘 할 일: ${summaryTitle}` : summaryTitle) : `${workdayCountdown.label} ${workdayCountdown.time}`}
            >{summaryTitle}</OverlayTitle>
          ) : (
            <OverlayTitle data-testid="now-focus-overlay-title">{title}</OverlayTitle>
          )}
        </button>
        <time
          className={styles.timer}
          data-testid="now-focus-overlay-leave-time"
          aria-label={`${workdayCountdown.label} ${workdayCountdown.time}`}
        >
          <span className={styles.timerLabel}>{workdayCountdown.label}</span>
          <strong className={styles.timerValue} data-testid="now-focus-overlay-leave-time-value">{workdayCountdown.time}</strong>
        </time>
        </div>
        {settingsOpen ? <OverlaySettingsModal settings={settings} privateMode={privateMode} onClose={onCloseSettings} onSubmit={onSaveSettings} onRefreshWidget={onRefreshWidget} refreshingWidget={refreshingWidget} /> : null}
      </div>
    </aside>
  );
}
