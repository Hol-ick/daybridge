import { useEffect, useRef, useState } from "react";
import { startOverlayDrag } from "../desktopWindow.js";
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

function formatLeaveTimer(value) {
  const now = value instanceof Date ? value : new Date(value);
  const deadline = new Date(now);
  deadline.setHours(18, 0, 0, 0);
  const remainingMinutes = Math.ceil((deadline.getTime() - now.getTime()) / 60_000);
  const safeMinutes = Math.max(0, remainingMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * A deliberately quiet, always-visible surface for the desktop corner.
 * It owns no timer or state: the host decides which block is current.
 */
export default function NowFocusOverlay({ nowFocus, onOpenDashboard, onComplete, privateMode = false }) {
  const dragRef = useRef({ point: null, cleanup: null, suppressClick: false });
  const feedbackTimerRef = useRef(null);
  const [feedback, setFeedback] = useState("");
  const [completing, setCompleting] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => () => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
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
  const timeLabel = start && end ? `${start} — ${end}` : start || end || "시간표 확인";
  const leaveTimer = formatLeaveTimer(currentTime);
  const canComplete = Boolean(!isBusy && blockId && typeof onComplete === "function");

  const handleComplete = async (event) => {
    event.stopPropagation();
    if (!canComplete || completing) return;
    setCompleting(true);
    setFeedback("저장 중");
    let result = false;
    try { result = await onComplete(blockId); } catch { result = false; }
    setCompleting(false);
    const succeeded = result !== false;
    setFeedback(succeeded ? "완료" : "다시 시도");
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(""), succeeded ? 900 : 1800);
  };

  const handleActionClick = (event) => {
    if (canComplete) {
      void handleComplete(event);
      return;
    }
    event.stopPropagation();
    onOpenDashboard?.();
  };

  const handlePointerDown = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const completeButton = target?.closest('[data-testid="now-focus-overlay-complete"]');
    const openButton = target?.closest('[data-testid="now-focus-overlay-open"]');
    if (event.button !== 0 || completeButton) return;
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

  const handleOpenDashboard = (event) => {
    if (dragRef.current.suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      dragRef.current.suppressClick = false;
      return;
    }
    onOpenDashboard?.();
  };

  return (
    <aside className={styles.overlay} aria-label="Daybridge 현재 할 일" data-testid="now-focus-overlay">
      <div className={styles.surface} onPointerDown={handlePointerDown} data-tauri-drag-region="deep">
        <button
          className={styles.open}
          type="button"
          onClick={handleOpenDashboard}
          data-tauri-drag-region="false"
          data-testid="now-focus-overlay-open"
          aria-label="Daybridge 전체 시간표 열기"
        >
          <span className={styles.meta}>
            <span className={styles.time} data-testid="now-focus-overlay-time">{timeLabel}</span>
          </span>
          <strong className={styles.title} data-testid="now-focus-overlay-title">{feedback || title}</strong>
        </button>
        {canComplete ? (
          <button
            className={styles.complete}
            type="button"
            onClick={handleActionClick}
            disabled={completing}
            data-tauri-drag-region="false"
            data-testid="now-focus-overlay-complete"
            aria-label={`${title} 완료`}
          >
            {completing ? "저장" : feedback || "완료"}
          </button>
        ) : (
          <time
            className={styles.timer}
            data-testid="now-focus-overlay-leave-time"
            aria-label={`퇴근까지 ${leaveTimer}`}
          >
            {leaveTimer}
          </time>
        )}
      </div>
    </aside>
  );
}
