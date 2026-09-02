import styles from "./ScheduleDashboard.module.css";
import ManualTaskForm from "./ManualTaskForm.jsx";

const TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
});

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value) {
  const date = asDate(value);
  return date ? TIME_FORMATTER.format(date) : "—";
}

function getFocusBlock(nowFocus) {
  return nowFocus?.block ?? nowFocus?.focusBlock ?? nowFocus ?? null;
}

function normalizeBlocks(schedule) {
  const direct = schedule?.blocks ?? schedule?.timeline ?? [];
  const focus = schedule?.focusBlocks ?? [];
  const busy = schedule?.busyBlocks ?? [];
  const buffer = schedule?.bufferBlocks ?? [];
  const blocks = direct.length ? direct : [...busy, ...focus, ...buffer];

  const listMode = schedule?.mode === "todo" || schedule?.timeConfigured === false;
  return [...blocks].filter((block) => !block?.hidden && blockKind(block) !== "buffer").sort((left, right) => {
    if (listMode) return (left.order ?? 0) - (right.order ?? 0);
    const leftTime = asDate(left.startAt ?? left.start)?.getTime() ?? 0;
    const rightTime = asDate(right.startAt ?? right.start)?.getTime() ?? 0;
    return leftTime - rightTime;
  });
}

function blockKind(block) {
  const kind = block?.kind ?? block?.type ?? block?.blockType;
  if (kind === "busy" || kind === "calendar") return "busy";
  if (kind === "buffer" || kind === "break") return "buffer";
  return "focus";
}

function getBlockTitle(block) {
  if (blockKind(block) === "busy") return "일정";
  if (blockKind(block) === "buffer") return "여유 시간";
  return block?.displayTitle ?? block?.scheduleTitle ?? block?.questTitle ?? block?.taskTitle ?? block?.title ?? "집중 작업";
}

function getUnscheduledCount(schedule) {
  if (Number.isFinite(schedule?.unscheduledCount)) return schedule.unscheduledCount;
  return Array.isArray(schedule?.unscheduled) ? schedule.unscheduled.length : 0;
}

function isCurrentBlock(block, nowFocus) {
  const current = getFocusBlock(nowFocus);
  const currentId = current?.id ?? nowFocus?.blockId;
  return Boolean(currentId && block?.id === currentId);
}

function TimelineBlock({ block, nowFocus, onOpenQuest, onCompleteBlock, onDeferBlock, listMode = false }) {
  const kind = blockKind(block);
  const current = isCurrentBlock(block, nowFocus);
  const title = getBlockTitle(block);
  const start = formatTime(block.startAt ?? block.start ?? block.startTime);
  const end = formatTime(block.endAt ?? block.end ?? block.endTime);
  const hasTime = !listMode && start !== "—";
  const blockId = block.id;
  const questId = block.questId ?? block.taskId ?? block.id;

  const handleOpenQuest = () => {
    if (kind === "focus" && onOpenQuest) onOpenQuest(questId);
  };

  const handleComplete = (event) => {
    event.stopPropagation();
    if (blockId && onCompleteBlock) onCompleteBlock(blockId);
  };

  const handleDefer = (event) => {
    event.stopPropagation();
    if (blockId && onDeferBlock) onDeferBlock(blockId);
  };

  const interactive = kind === "focus" && Boolean(onOpenQuest);
  const className = [styles.timelineBlock, styles[kind], current ? styles.current : ""].filter(Boolean).join(" ");

  return (
    <li className={styles.timelineRow} data-testid={`schedule-block-${blockId ?? "unknown"}`}>
      {hasTime ? <time className={styles.blockTime}>{start}</time> : <span className={styles.blockTimePlaceholder} aria-hidden="true" />}
      <div className={styles.track} aria-hidden="true">
        <span className={styles.rail} />
        <span className={styles.blockDot} />
      </div>
      <div className={className}>
        {interactive ? (
          <button type="button" className={styles.blockOpen} onClick={handleOpenQuest} data-testid={`schedule-block-open-${blockId}`}>
            <span>{title}</span>
            {hasTime ? <small>{end}</small> : null}
          </button>
        ) : (
          <div className={styles.blockStatic}>
            <span>{title}</span>
            {hasTime ? <small>{end}</small> : null}
          </div>
        )}
        {kind === "focus" ? (
          <div className={styles.blockActions}>
            <button type="button" onClick={handleDefer} data-testid={`schedule-block-defer-${blockId}`} aria-label={`${title} 미루기`}>미루기</button>
            <button type="button" onClick={handleComplete} data-testid={`schedule-block-complete-${blockId}`} aria-label={`${title} 완료`}>완료</button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The full management surface. The host passes already-derived schedule data
 * and retains ownership of loading, command handling and persistence.
 */
export default function ScheduleDashboard({
  schedule,
  nowFocus,
  onOpenQuest,
  onCompleteBlock,
  onDeferBlock,
  onOpenSettings,
  calendarCoverage,
  calendarConnection,
  onConnectCalendar,
  onAddManualTask,
}) {
  const focus = getFocusBlock(nowFocus);
  const listMode = schedule?.mode === "todo" || schedule?.timeConfigured === false;
  const focusKind = blockKind(focus);
  const focusId = focusKind === "busy" ? "" : focus?.id ?? nowFocus?.blockId;
  const focusTitle = listMode ? "오늘 할 일을 하나씩 진행하세요" : focusKind === "busy" ? "일정 중" : focus?.displayTitle ?? focus?.scheduleTitle ?? focus?.questTitle ?? focus?.taskTitle ?? focus?.title ?? "다음 집중 시간 준비 중";
  const focusStart = formatTime(focus?.startAt ?? focus?.start ?? focus?.startTime);
  const focusEnd = formatTime(focus?.endAt ?? focus?.end ?? focus?.endTime);
  const blocks = normalizeBlocks(schedule);
  const unscheduledCount = getUnscheduledCount(schedule);
  const scheduleLabel = listMode ? "오늘 할 일" : schedule?.label ?? schedule?.dateLabel ?? "오늘 시간표";
  const coverageState = calendarConnection?.state ?? calendarCoverage?.state ?? calendarCoverage ?? "unknown";
  const coverageLabel = coverageState === "connected"
    ? "Google Calendar 연결됨"
    : coverageState === "needs_authorization"
      ? "Google Calendar 승인 필요"
      : coverageState === "unconfigured"
        ? "Google Calendar 연결 준비 필요"
        : "캘린더 확인 필요";

  return (
    <main className={styles.dashboard} data-testid="schedule-dashboard">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>DAYBRIDGE</p>
          <h1>{scheduleLabel}</h1>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.coverage} data-testid="calendar-coverage" aria-label={coverageLabel} title={coverageLabel} data-state={coverageState} />
          <button type="button" onClick={onConnectCalendar} data-testid="calendar-connect">캘린더</button>
          <button type="button" onClick={onOpenSettings} data-testid="schedule-settings" aria-label="시간표 설정">설정</button>
        </div>
      </header>

      <section className={styles.nowCard} aria-labelledby="now-focus-title" data-testid="schedule-now-focus">
        <p id="now-focus-title">{listMode ? "오늘 할 일" : "지금 할 일"}</p>
        <div className={styles.nowContent}>
          <div>
            {!listMode ? <span className={styles.nowTime}>{focusStart} — {focusEnd}</span> : null}
            <h2>{focusTitle}</h2>
          </div>
          {!listMode ? <button
              type="button"
              className={styles.nowComplete}
              onClick={() => focusId && onCompleteBlock?.(focusId)}
              disabled={!focusId || !onCompleteBlock}
              data-testid="schedule-now-focus-complete"
            >
              완료
            </button> : null}
        </div>
      </section>

      <section className={styles.timelineSection} aria-labelledby="timeline-title">
        <div className={styles.sectionHeading}>
          <h2 id="timeline-title">{listMode ? "목록" : "시간표"}</h2>
          <div className={styles.sectionTools}>
            {unscheduledCount > 0 ? <span data-testid="schedule-unscheduled-count">미배치 {unscheduledCount}</span> : null}
            <ManualTaskForm onSubmit={onAddManualTask} />
          </div>
        </div>
        {blocks.length > 0 ? (
          <ol className={styles.timeline} data-testid="schedule-timeline">
            {blocks.map((block) => (
              <TimelineBlock
                key={block.id ?? `${block.startAt ?? block.start}-${getBlockTitle(block)}`}
                block={block}
                nowFocus={nowFocus}
                onOpenQuest={onOpenQuest}
                onCompleteBlock={onCompleteBlock}
                onDeferBlock={onDeferBlock}
                listMode={listMode}
              />
            ))}
          </ol>
        ) : (
          <div className={styles.empty} data-testid="schedule-empty">{listMode ? "오늘 할 일이 없습니다." : "시간표를 만들면 오늘의 집중 시간이 여기에 놓입니다."}</div>
        )}
      </section>
    </main>
  );
}
