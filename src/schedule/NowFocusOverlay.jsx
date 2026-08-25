import { useEffect, useMemo, useRef, useState } from "react";
import { OVERLAY_COLLAPSED_HEIGHT, OVERLAY_EXPANDED_HEIGHT, resizeOverlay, startOverlayDrag } from "../desktopWindow.js";
import { getWorkdayCountdown } from "./workday-clock.js";
import styles from "./NowFocusOverlay.module.css";

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
  return nowFocus?.block ?? nowFocus?.focusBlock ?? nowFocus ?? null;
}

function getScheduleBlocks(schedule) {
  const direct = schedule?.blocks ?? schedule?.timeline ?? [];
  const focus = schedule?.focusBlocks ?? [];
  const busy = schedule?.busyBlocks ?? [];
  const buffer = schedule?.bufferBlocks ?? [];
  const blocks = direct.length ? direct : [...busy, ...focus, ...buffer];
  return [...blocks].filter((block) => scheduleBlockKind(block) !== "buffer").sort((left, right) => {
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

function OverlayScheduleItem({ block, privateMode, actionId, onComplete, onDefer }) {
  const kind = scheduleBlockKind(block);
  const status = block?.status;
  const actionable = kind === "focus" && status !== "completed" && status !== "deferred";
  const start = formatTime(block?.startAt ?? block?.start ?? block?.startTime);
  const title = privateMode && kind === "focus" ? "집중 시간" : scheduleBlockTitle(block);
  const label = start;

  return (
    <li className={[styles.compactBlock, styles[kind], status === "completed" ? styles.completed : ""].filter(Boolean).join(" ")} data-testid={`now-focus-overlay-block-${block?.id ?? "unknown"}`}>
      <span className={styles.compactBlockTime}>{label}</span>
      <strong className={styles.compactBlockTitle} title={title}>{title}</strong>
      {actionable ? (
        <div className={styles.compactActions}>
          <button type="button" disabled={Boolean(actionId)} onClick={(event) => onDefer(block.id, event)} data-tauri-drag-region="false" data-testid={`now-focus-overlay-defer-${block.id}`}>미룸</button>
          <button type="button" disabled={Boolean(actionId)} onClick={(event) => onComplete(block.id, event)} data-tauri-drag-region="false" data-testid={`now-focus-overlay-complete-${block.id}`}>완료</button>
        </div>
      ) : (
        <span className={styles.compactStatus}>{status === "completed" ? "완료" : status === "deferred" ? "보류" : kind === "busy" ? "일정" : "여유"}</span>
      )}
    </li>
  );
}

/**
 * A deliberately quiet, always-visible surface for the desktop corner.
 * It owns no timer or state: the host decides which block is current.
 */
export default function NowFocusOverlay({ schedule, nowFocus, onOpenDashboard, onComplete, onDefer, onRebuild, privateMode = false }) {
  const dragRef = useRef({ point: null, cleanup: null, suppressClick: false });
  const feedbackTimerRef = useRef(null);
  const resizeTimerRef = useRef(null);
  const [feedback, setFeedback] = useState("");
  const [actionId, setActionId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => () => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    if (resizeTimerRef.current) window.clearTimeout(resizeTimerRef.current);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const block = getFocusBlock(nowFocus);
  const blockId = block?.id ?? nowFocus?.blockId;
  const blockKind = block?.kind ?? block?.type ?? block?.blockType;
  const isBusy = blockKind === "busy" || blockKind === "calendar";
  const sourceTitle = isBusy ? "일정 중" : block?.displayTitle ?? block?.scheduleTitle ?? block?.questTitle ?? block?.taskTitle ?? block?.title ?? "다음 집중 시간 준비 중";
  const title = privateMode && block ? "집중 시간" : sourceTitle;
  const start = formatTime(block?.startAt ?? block?.start ?? block?.startTime);
  const end = formatTime(block?.endAt ?? block?.end ?? block?.endTime);
  const timeLabel = start && end ? `${start} — ${end}` : start || end || "";
  const workdayCountdown = getWorkdayCountdown(currentTime);
  const canComplete = Boolean(!isBusy && blockId && typeof onComplete === "function");
  const blocks = useMemo(() => getScheduleBlocks(schedule), [schedule]);
  const focusBlocks = blocks.filter((item) => scheduleBlockKind(item) === "focus");
  const completedCount = focusBlocks.filter((item) => item.status === "completed").length;

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

  const handleComplete = async (targetBlockId, event) => {
    event.stopPropagation();
    if (!targetBlockId || !onComplete || actionId) return;
    setActionId(targetBlockId);
    if (targetBlockId === blockId) setFeedback("저장 중");
    let result = false;
    try { result = await onComplete(targetBlockId); } catch { result = false; }
    setActionId("");
    const succeeded = result !== false;
    if (targetBlockId !== blockId) return;
    setFeedback(succeeded ? "완료" : "다시 시도");
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(""), succeeded ? 900 : 1800);
  };

  const handleDefer = async (targetBlockId, event) => {
    event.stopPropagation();
    if (!targetBlockId || !onDefer || actionId) return;
    setActionId(targetBlockId);
    try { await onDefer(targetBlockId); } finally { setActionId(""); }
  };

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
          <header className={styles.expandedHeader}>
            <div><span>오늘 일정</span><strong>{completedCount}/{focusBlocks.length || 0}</strong></div>
            <button type="button" onClick={() => setExpandedMode(false)} data-tauri-drag-region="false" data-testid="now-focus-overlay-collapse" aria-label="시간표 접기">접기</button>
          </header>
          {blocks.length ? (
            <ol className={styles.compactList}>
              {blocks.map((item) => (
                <OverlayScheduleItem
                  key={item.id ?? `${item.startAt}-${scheduleBlockTitle(item)}`}
                  block={item}
                  privateMode={privateMode}
                  actionId={actionId}
                  onComplete={handleComplete}
                  onDefer={handleDefer}
                />
              ))}
            </ol>
          ) : <p className={styles.compactEmpty}>오늘 배치된 일정이 없습니다.</p>}
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
          <strong className={styles.title} data-testid="now-focus-overlay-title">{feedback || title}</strong>
        </button>
        {canComplete ? (
          <button
            className={styles.complete}
            type="button"
            onClick={(event) => { void handleComplete(blockId, event); }}
            disabled={actionId === blockId}
            data-tauri-drag-region="false"
            data-testid="now-focus-overlay-complete"
            aria-label={`${title} 완료`}
          >
            {actionId === blockId ? "저장" : feedback || "완료"}
          </button>
        ) : (
          <time
            className={styles.timer}
            data-testid="now-focus-overlay-leave-time"
            aria-label={`${workdayCountdown.label} ${workdayCountdown.time}`}
          >
            <span className={styles.timerLabel}>{workdayCountdown.label}</span>
            <strong className={styles.timerValue} data-testid="now-focus-overlay-leave-time-value">{workdayCountdown.time}</strong>
          </time>
        )}
        </div>
      </div>
    </aside>
  );
}
