const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_MEALS = Object.freeze({
  breakfast: Object.freeze({ enabled: false, start: "08:00", end: "09:00", label: "아침시간" }),
  lunch: Object.freeze({ enabled: true, start: "11:30", end: "13:00", label: "점심시간" }),
  dinner: Object.freeze({ enabled: false, start: "18:00", end: "19:00", label: "저녁시간" }),
});
export const DEFAULT_SCHEDULE_SETTINGS = Object.freeze({
  schemaVersion: 1, timeZone: "Asia/Seoul", dayStart: "", dayEnd: "", timeConfigured: false,
  focusDurations: Object.freeze([50]), defaultFocusMinutes: 50, bufferMinutes: 10,
  breaks: Object.freeze([]), meals: DEFAULT_MEALS,
});

function range(input, fallbackLabel) {
  const start = typeof input?.start === "string" ? input.start.trim() : "";
  const end = typeof input?.end === "string" ? input.end.trim() : "";
  if (!TIME.test(start) || !TIME.test(end) || start >= end) throw new TypeError("휴식 시작·종료 시간을 확인해 주세요.");
  return { start, end, label: String(input.label || fallbackLabel).trim().slice(0, 80) || fallbackLabel };
}

export function normalizeScheduleSettings(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("설정은 객체여야 합니다.");
  const dayStart = typeof input.dayStart === "string" ? input.dayStart.trim() : "";
  const dayEnd = typeof input.dayEnd === "string" ? input.dayEnd.trim() : "";
  if (Boolean(dayStart) !== Boolean(dayEnd)) throw new TypeError("시작·종료 시간을 모두 입력해 주세요.");
  if ((dayStart || dayEnd) && (!TIME.test(dayStart) || !TIME.test(dayEnd) || dayStart >= dayEnd)) throw new TypeError("시작 시간은 종료 시간보다 빨라야 합니다.");
  if (Object.hasOwn(input, "timeConfigured") && typeof input.timeConfigured !== "boolean") throw new TypeError("시간 설정 여부를 확인해 주세요.");
  const timeConfigured = input.timeConfigured === true || input.timeConfigured !== false && Boolean(dayStart && dayEnd);
  if (timeConfigured && !dayStart) throw new TypeError("시작·종료 시간을 모두 입력해 주세요.");
  const rawBuffer = input.bufferMinutes === undefined ? 10 : input.bufferMinutes;
  const bufferMinutes = typeof rawBuffer === "number" || typeof rawBuffer === "string" && rawBuffer.trim() ? Number(rawBuffer) : NaN;
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 30) throw new TypeError("완충시간은 0~30분의 정수로 입력해 주세요.");
  const hasMeals = Object.hasOwn(input, "meals");
  const hasBreaks = Object.hasOwn(input, "breaks");
  if (hasBreaks && !Array.isArray(input.breaks)) throw new TypeError("휴식 설정은 목록이어야 합니다.");
  if (hasMeals && (!input.meals || typeof input.meals !== "object" || Array.isArray(input.meals))) throw new TypeError("식사 설정을 확인해 주세요.");
  let meals;
  let breaks;
  if (hasMeals || !hasBreaks || input.breaks.length === 0) {
    meals = {};
    for (const [key, fallback] of Object.entries(DEFAULT_MEALS)) {
      const item = hasMeals ? input.meals[key] : undefined;
      if (item !== undefined && (!item || typeof item !== "object" || Array.isArray(item))) throw new TypeError("식사 설정을 확인해 주세요.");
      if (item?.enabled !== undefined && typeof item.enabled !== "boolean") throw new TypeError("식사 사용 여부를 확인해 주세요.");
      meals[key] = { ...range({ ...fallback, ...item }, fallback.label), enabled: item?.enabled ?? (hasBreaks && !hasMeals ? false : fallback.enabled) };
    }
    breaks = Object.values(meals).filter(item => item.enabled).map(({ start, end, label }) => ({ start, end, label }));
  } else {
    breaks = input.breaks.map(item => range(item, "휴식 시간"));
  }
  return {
    schemaVersion: 1, timeZone: "Asia/Seoul",
    dayStart: timeConfigured ? dayStart : "", dayEnd: timeConfigured ? dayEnd : "", timeConfigured,
    focusDurations: [50], defaultFocusMinutes: 50, bufferMinutes,
    breaks: timeConfigured ? breaks : [], ...(meals ? { meals } : {}),
  };
}
