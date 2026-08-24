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

/**
 * A deliberately quiet, always-visible surface for the desktop corner.
 * It owns no timer or state: the host decides which block is current.
 */
export default function NowFocusOverlay({ nowFocus, onOpenDashboard, onComplete, privateMode = false }) {
  const block = getFocusBlock(nowFocus);
  const blockId = block?.id ?? nowFocus?.blockId;
  const blockKind = block?.kind ?? block?.type ?? block?.blockType;
  const isBusy = blockKind === "busy" || blockKind === "calendar";
  const sourceTitle = isBusy ? "일정 중" : block?.questTitle ?? block?.taskTitle ?? block?.title ?? "다음 집중 시간 준비 중";
  const title = privateMode && block ? "집중 시간" : sourceTitle;
  const start = formatTime(block?.startAt ?? block?.start ?? block?.startTime);
  const end = formatTime(block?.endAt ?? block?.end ?? block?.endTime);
  const timeLabel = start && end ? `${start} — ${end}` : start || end || "시간표 확인";
  const canComplete = Boolean(!isBusy && blockId && typeof onComplete === "function");

  const handleComplete = (event) => {
    event.stopPropagation();
    if (canComplete) onComplete(blockId);
  };

  return (
    <aside className={styles.overlay} aria-label="Daybridge 현재 할 일" data-testid="now-focus-overlay">
      <div className={styles.surface}>
        <button
          className={styles.open}
          type="button"
          onClick={onOpenDashboard}
          data-testid="now-focus-overlay-open"
          aria-label="Daybridge 전체 시간표 열기"
        >
          <span className={styles.time} data-testid="now-focus-overlay-time">{timeLabel}</span>
          <strong className={styles.title} data-testid="now-focus-overlay-title">{title}</strong>
        </button>
        <button
          className={styles.complete}
          type="button"
          onClick={handleComplete}
          disabled={!canComplete}
          data-testid="now-focus-overlay-complete"
          aria-label={canComplete ? `${title} 완료` : "완료할 집중 시간이 없습니다"}
        >
          완료
        </button>
      </div>
    </aside>
  );
}
