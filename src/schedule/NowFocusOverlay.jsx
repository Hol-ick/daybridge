import { useEffect, useMemo, useRef, useState } from "react";
import { OVERLAY_COLLAPSED_HEIGHT, OVERLAY_EXPANDED_HEIGHT, resizeOverlay, startOverlayDrag } from "../desktopWindow.js";
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
  return [...blocks].filter((block) => !block?.hidden && scheduleBlockKind(block) !== "buffer").sort((left, right) => {
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

function OverlayScheduleItem({ block, privateMode, onMove, onPointerDragStart, onPointerDragMove, onPointerDragEnd, onKeyboardMove, draggingBlockId, dropTargetId }) {
  const kind = scheduleBlockKind(block);
  const status = block?.status;
  const actionable = kind === "focus" && status !== "completed" && status !== "deferred";
  const start = formatTime(block?.startAt ?? block?.start ?? block?.startTime);
  const title = privateMode && kind === "focus" ? "집중 시간" : scheduleBlockTitle(block);
  const label = start;
  const draggable = actionable && typeof onMove === "function";
  const handleKeyDown = (event) => {
    if (!draggable || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    onKeyboardMove?.(block.id, event.key);
  };

  return (
    <li
      className={[styles.compactBlock, styles[kind], status === "completed" ? styles.completed : "", draggingBlockId === block?.id ? styles.dragging : "", dropTargetId === block?.id ? styles.dropTarget : ""].filter(Boolean).join(" ")}
      data-testid={`now-focus-overlay-block-${block?.id ?? "unknown"}`}
      data-block-id={block?.id ?? ""}
      data-drag-enabled={draggable ? "true" : "false"}
      data-dragging={draggingBlockId === block?.id ? "true" : "false"}
      data-drop-target={dropTargetId === block?.id ? "true" : "false"}
      tabIndex={draggable ? 0 : undefined}
      onKeyDown={handleKeyDown}
      onPointerDown={draggable ? (event) => onPointerDragStart(event, block) : undefined}
      onPointerMove={draggable ? onPointerDragMove : undefined}
      onPointerUp={draggable ? onPointerDragEnd : undefined}
      onPointerCancel={draggable ? onPointerDragEnd : undefined}
      data-tauri-drag-region="false"
    >
      <div className={styles.compactBlockTop}>
        <span className={styles.compactBlockTime}>{label}</span>
      </div>
      <OverlayTitle className={styles.compactBlockTitle} title={title} aria-label={title}>{title}</OverlayTitle>
    </li>
  );
}

/**
 * A deliberately quiet, always-visible surface for the desktop corner.
 * It owns no timer or state: the host decides which block is current.
 */
export default function NowFocusOverlay({ schedule, nowFocus, onOpenDashboard, onRebuild, onAddManualTask, onMoveBlock, privateMode = false }) {
  const dragRef = useRef({ point: null, cleanup: null, suppressClick: false });
  const pointerDragRef = useRef({ blockId: "", pointerId: null, startX: 0, startY: 0, started: false });
  const resizeTimerRef = useRef(null);
  const [draggingBlockId, setDraggingBlockId] = useState("");
  const [dropTargetId, setDropTargetId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => () => {
    if (resizeTimerRef.current) window.clearTimeout(resizeTimerRef.current);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const block = getFocusBlock(nowFocus);
  const blockKind = block?.kind ?? block?.type ?? block?.blockType;
  const isBusy = blockKind === "busy" || blockKind === "calendar";
  const sourceTitle = isBusy ? (block?.hidden ? block?.title ?? "점심시간" : "일정 중") : block?.displayTitle ?? block?.scheduleTitle ?? block?.questTitle ?? block?.taskTitle ?? block?.title ?? "다음 집중 시간 준비 중";
  const title = privateMode && block ? "집중 시간" : sourceTitle;
  const idle = !block;
  const showIdleTitle = idle;
  const start = formatTime(block?.startAt ?? block?.start ?? block?.startTime);
  const end = formatTime(block?.endAt ?? block?.end ?? block?.endTime);
  const timeLabel = start && end ? `${start} — ${end}` : start || end || "";
  const workdayCountdown = getWorkdayCountdown(currentTime);
  const blocks = useMemo(() => getScheduleBlocks(schedule), [schedule]);

  const movableBlocks = useMemo(() => blocks.filter((item) => scheduleBlockKind(item) === "focus" && !["completed", "deferred", "skipped"].includes(item?.status)), [blocks]);
  const findDropTarget = (clientX, clientY) => {
    const element = document.elementFromPoint(clientX, clientY);
    const card = element instanceof Element ? element.closest("[data-block-id]") : null;
    const targetId = card?.getAttribute("data-block-id") || "";
    return movableBlocks.some((item) => item.id === targetId) ? { card, targetId } : { card: null, targetId: "" };
  };
  const clearPointerDrag = () => {
    pointerDragRef.current = { blockId: "", pointerId: null, startX: 0, startY: 0, started: false };
    setDraggingBlockId("");
    setDropTargetId("");
  };
  const handleSchedulePointerDragStart = (event, item) => {
    if (!onMoveBlock || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* pointer capture is optional */ }
    pointerDragRef.current = { blockId: item.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false };
  };
  const handleSchedulePointerDragMove = (event) => {
    const state = pointerDragRef.current;
    if (!state.blockId || state.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
    if (!state.started && distance < 6) return;
    if (!state.started) {
      state.started = true;
      setDraggingBlockId(state.blockId);
    }
    event.preventDefault();
    event.stopPropagation();
    const target = findDropTarget(event.clientX, event.clientY);
    setDropTargetId(target.targetId && target.targetId !== state.blockId ? target.targetId : "");
  };
  const handleSchedulePointerDragEnd = async (event) => {
    const state = pointerDragRef.current;
    if (!state.blockId || state.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!state.started) {
      clearPointerDrag();
      return;
    }
    const sourceId = state.blockId;
    const target = findDropTarget(event.clientX, event.clientY);
    const targetItem = movableBlocks.find((item) => item.id === target.targetId && item.id !== sourceId);
    const rect = target.card?.getBoundingClientRect();
    const position = rect && event.clientY < rect.top + (rect.height / 2) ? "before" : "after";
    clearPointerDrag();
    if (targetItem && onMoveBlock) await onMoveBlock(sourceId, targetItem.id, position);
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
      void resizeOverlay(OVERLAY_EXPANDED_HEIGHT).catch(() => false).finally(() => setExpanded(true));
    } else {
      setExpanded(false);
      resizeTimerRef.current = window.setTimeout(() => {
        void resizeOverlay(OVERLAY_COLLAPSED_HEIGHT);
      }, 280);
    }
  };

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
  }, [expanded]);

  const handlePointerDown = (event) => {
    window.getSelection?.()?.removeAllRanges();
    const target = event.target instanceof Element ? event.target : null;
    const openButton = target?.closest('[data-testid="now-focus-overlay-open"]');
    const interactive = target?.closest('[data-tauri-drag-region="false"]');
    if (event.button !== 0 || (interactive && !openButton)) return;
    const state = dragRef.current;
    state.point = { x: event.clientX, y: event.clientY };
    const cleanup = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", cleanup);
      document.removeEventListener("pointercancel", cleanup);
      state.point = null;
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
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", cleanup, { once: true });
    document.addEventListener("pointercancel", cleanup, { once: true });
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

  const handleOpenDashboard = (event) => {
    event.stopPropagation();
    onOpenDashboard?.();
  };

  const surfaceClassName = [styles.surface, expanded ? styles.expanded : ""].filter(Boolean).join(" ");

  return (
    <aside className={styles.overlay} aria-label="Daybridge 현재 할 일" data-testid="now-focus-overlay">
      <div className={surfaceClassName} onPointerDown={handlePointerDown} data-tauri-drag-region="deep" data-testid="now-focus-overlay-surface">
        <section className={styles.expandedPanel} aria-label="오늘 시간표 관리" aria-hidden={!expanded} data-tauri-drag-region="false" data-testid="now-focus-overlay-expanded">
          {blocks.length ? (
            <ol className={styles.compactList}>
              {blocks.map((item) => (
                <OverlayScheduleItem
                  key={item.id ?? `${item.startAt}-${scheduleBlockTitle(item)}`}
                  block={item}
                  privateMode={privateMode}
                  onMove={onMoveBlock}
                  onPointerDragStart={handleSchedulePointerDragStart}
                  onPointerDragMove={handleSchedulePointerDragMove}
                  onPointerDragEnd={handleSchedulePointerDragEnd}
                  onKeyboardMove={handleKeyboardMove}
                  draggingBlockId={draggingBlockId}
                  dropTargetId={dropTargetId}
                />
              ))}
            </ol>
          ) : <p className={styles.compactEmpty}>오늘 배치된 일정이 없습니다.</p>}
          <div className={styles.manualTaskBottom}>
            <ManualTaskForm compact onSubmit={onAddManualTask} />
          </div>
          <footer className={styles.expandedFooter}>
            <button type="button" onClick={onRebuild} disabled={!onRebuild} data-tauri-drag-region="false">재배치</button>
            <button type="button" onClick={handleOpenDashboard} data-tauri-drag-region="false">전체 시간표</button>
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
              aria-label={`${workdayCountdown.label} ${workdayCountdown.time}`}
            >{workdayCountdown.label}</OverlayTitle>
          ) : (
            <OverlayTitle data-testid="now-focus-overlay-title">{title}</OverlayTitle>
          )}
        </button>
        <time
          className={styles.timer}
          data-testid="now-focus-overlay-leave-time"
          aria-label={`${workdayCountdown.label} ${workdayCountdown.time}`}
        >
          {block ? <span className={styles.timerLabel}>{workdayCountdown.label}</span> : null}
          <strong className={styles.timerValue} data-testid="now-focus-overlay-leave-time-value">{workdayCountdown.time}</strong>
        </time>
        </div>
      </div>
    </aside>
  );
}
