const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The overlay is a today view. A persisted board can be yesterday's board
 * when the bridge was unavailable during startup, so never let that stale
 * value decide which schedule the widget requests.
 */
export function resolveActivityDate(board, today) {
  if (!DATE_PATTERN.test(today)) return today;
  return board?.activityDate === today ? board.activityDate : today;
}
