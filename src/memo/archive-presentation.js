/** @param {number} timestamp @param {number} now */
export function formatArchiveTime(timestamp, now = Date.now()) {
  const date = new Date(timestamp), today = new Date(now);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(today.getTime())) return '날짜 없음';
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const sameDay = (/** @type {Date} */ other) => date.getFullYear() === other.getFullYear() && date.getMonth() === other.getMonth() && date.getDate() === other.getDate();
  const day = sameDay(today) ? '오늘' : sameDay(yesterday) ? '어제' : date.toLocaleDateString('ko-KR', {year:date.getFullYear() === today.getFullYear() ? undefined : 'numeric', month:'numeric',day:'numeric'});
  return `${day} · ${date.toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit'})}`;
}
