const WORKDAY_TIMES = {
  morningStart: [9, 0],
  lunchStart: [11, 30],
  afternoonStart: [13, 0],
  workdayEnd: [18, 0],
};

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function atLocalTime(date, [hours, minutes]) {
  const target = new Date(date.getTime());
  target.setHours(hours, minutes, 0, 0);
  return target;
}

function formatDuration(totalMinutes) {
  const safeMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Returns the countdown to the next workday boundary in local time.
 *
 * Morning: 09:00 -> 11:30
 * Lunch: 11:30 -> 13:00
 * Afternoon: 13:00 -> 18:00
 */
export function getWorkdayCountdown(value) {
  const now = asDate(value);
  const boundaries = {
    morningStart: atLocalTime(now, WORKDAY_TIMES.morningStart),
    lunchStart: atLocalTime(now, WORKDAY_TIMES.lunchStart),
    afternoonStart: atLocalTime(now, WORKDAY_TIMES.afternoonStart),
    workdayEnd: atLocalTime(now, WORKDAY_TIMES.workdayEnd),
  };

  let phase = "after_work";
  let label = "근무 종료";
  let target = null;
  if (now < boundaries.morningStart) {
    phase = "before_work";
    label = "근무 시작까지";
    target = boundaries.morningStart;
  } else if (now < boundaries.lunchStart) {
    phase = "morning";
    label = "점심까지";
    target = boundaries.lunchStart;
  } else if (now < boundaries.afternoonStart) {
    phase = "lunch";
    label = "오후 시작까지";
    target = boundaries.afternoonStart;
  } else if (now < boundaries.workdayEnd) {
    phase = "afternoon";
    label = "퇴근까지";
    target = boundaries.workdayEnd;
  }

  const remainingMinutes = target ? Math.ceil((target.getTime() - now.getTime()) / 60_000) : 0;
  return {
    phase,
    label,
    remainingMinutes,
    time: formatDuration(remainingMinutes),
  };
}
