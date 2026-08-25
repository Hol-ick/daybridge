import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useAppActions, useAppState } from "./AppContext.jsx";
import { bindOverlayMagnet, currentSurface, openDashboard, placeOverlayInCorner } from "./desktopWindow.js";
import Item from "./todometer/components/Item.jsx";
import NowFocusOverlay from "./schedule/NowFocusOverlay.jsx";
import ScheduleDashboard from "./schedule/ScheduleDashboard.jsx";
import { getWorkdayCountdown } from "./schedule/workday-clock.js";
import styles from "./ScheduleSurface.module.css";

const BRIDGE_URL = "http://127.0.0.1:39393";
const OVERLAY_PRIVACY_KEY = "daybridge.overlay-private.v1";

function kstDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function initialPrivateMode() {
  try { return localStorage.getItem(OVERLAY_PRIVACY_KEY) === "true"; } catch { return false; }
}

async function readJson(response) {
  if (!response.ok) throw new Error(`bridge request failed (${response.status})`);
  return response.json();
}

export default function ScheduleSurface() {
  const { board, expandedQuestId } = useAppState();
  const { toggleQuest, refresh } = useAppActions();
  const [surface] = useState(currentSurface);
  const [schedule, setSchedule] = useState(null);
  const [nowFocus, setNowFocus] = useState(null);
  const [calendarCoverage, setCalendarCoverage] = useState("attention");
  const [calendarConnection, setCalendarConnection] = useState({ state: "attention", reason: "status_pending" });
  const [settings, setSettings] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [privateMode, setPrivateMode] = useState(initialPrivateMode);
  const [notice, setNotice] = useState("");
  const activityDate = board?.activityDate || kstDate();

  useEffect(() => {
    document.body.dataset.surface = surface;
    return () => { delete document.body.dataset.surface; };
  }, [surface]);

  useEffect(() => {
    if (surface !== "overlay" || !isTauri() || import.meta.env.DEV) return undefined;
    let timeoutId;
    let disposed = false;
    const checkWorkdayEnd = () => {
      if (disposed) return;
      if (getWorkdayCountdown(new Date()).phase === "after_work") {
        void invoke("exit_app");
        return;
      }
      const now = new Date();
      const workdayEnd = new Date(now);
      workdayEnd.setHours(18, 0, 0, 0);
      const delay = Math.max(1_000, Math.min(workdayEnd.getTime() - now.getTime(), 30_000));
      timeoutId = window.setTimeout(checkWorkdayEnd, delay);
    };
    checkWorkdayEnd();
    return () => {
      disposed = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [surface]);

  const loadSchedule = useCallback(async ({ rebuild = false, quiet = false } = {}) => {
    const request = rebuild
      ? fetch(`${BRIDGE_URL}/api/schedule/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate }) })
      : fetch(`${BRIDGE_URL}/api/schedule?date=${activityDate}`);
    try {
      const result = await readJson(await request);
      setSchedule(result.schedule);
      setNowFocus(result.nowFocus);
      setCalendarCoverage(result.schedule?.calendar?.coverage || "attention");
      if (!quiet) setNotice(rebuild ? "오늘 남은 시간을 다시 배치했어요" : "");
      return result;
    } catch {
      if (!quiet) setNotice("시간표를 불러오지 못했어요");
      return null;
    }
  }, [activityDate]);

  const loadSettings = useCallback(async () => {
    try {
      const result = await readJson(await fetch(`${BRIDGE_URL}/api/schedule-settings`));
      setSettings(result.settings);
    } catch { setNotice("시간표 설정을 불러오지 못했어요"); }
  }, []);

  const addManualTask = useCallback(async ({ title, durationMinutes }) => {
    try {
      const result = await readJson(await fetch(`${BRIDGE_URL}/api/quests/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityDate, title, durationMinutes }),
      }));
      setSchedule(result.schedule);
      setNowFocus(result.nowFocus);
      await refresh();
      setNotice(`${title} · ${durationMinutes}분으로 배치했어요`);
      return true;
    } catch {
      setNotice("작업을 추가하지 못했어요. 제목과 시간을 확인해 주세요");
      return false;
    }
  }, [activityDate, refresh]);

  const loadCalendarStatus = useCallback(async ({ quiet = false } = {}) => {
    try {
      const result = await readJson(await fetch(`${BRIDGE_URL}/api/calendar/status`));
      setCalendarConnection(result.calendar || { state: "attention", reason: "status_unavailable" });
      return result.calendar;
    } catch {
      if (!quiet) setNotice("캘린더 연결 상태를 확인하지 못했어요");
      return null;
    }
  }, []);

  useEffect(() => { void loadSchedule({ quiet: true }); }, [loadSchedule]);
  useEffect(() => { void loadCalendarStatus({ quiet: true }); }, [loadCalendarStatus]);
  useEffect(() => {
    const interval = window.setInterval(() => { void loadSchedule({ quiet: true }); }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadSchedule]);
  useEffect(() => {
    const syncPrivacyMode = (event) => {
      if (event.key === OVERLAY_PRIVACY_KEY) setPrivateMode(event.newValue === "true");
    };
    window.addEventListener("storage", syncPrivacyMode);
    return () => window.removeEventListener("storage", syncPrivacyMode);
  }, []);
  useEffect(() => { if (surface === "overlay") void placeOverlayInCorner(); }, [surface]);
  useEffect(() => {
    if (surface !== "overlay") return undefined;
    let disposed = false;
    let cleanup;
    void bindOverlayMagnet().then((dispose) => {
      if (disposed) dispose();
      else cleanup = dispose;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [surface]);

  const reportBlock = useCallback(async (blockId, status) => {
    try {
      const result = await readJson(await fetch(`${BRIDGE_URL}/api/schedule/block-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityDate, blockId, status, note: status === "completed" ? "집중 블록 완료" : "집중 블록을 다음으로 미룸" }),
      }));
      setSchedule(result.schedule);
      setNowFocus(result.nowFocus);
      setNotice(status === "completed" ? "집중 시간을 완료했어요" : "이 작업은 다음 계획으로 넘겼어요");
      void refresh();
      return true;
    } catch { setNotice("진행 상태를 저장하지 못했어요"); return false; }
  }, [activityDate, refresh]);

  const moveBlock = useCallback(async (blockId, targetBlockId, position) => {
    try {
      const result = await readJson(await fetch(`${BRIDGE_URL}/api/schedule/block-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityDate, blockId, targetBlockId, position }),
      }));
      setSchedule(result.schedule);
      setNowFocus(result.nowFocus);
      setNotice("시간표 위치를 바꿨어요");
      void refresh();
      return true;
    } catch {
      setNotice("근무시간 안에서만 순서를 바꿀 수 있어요");
      return false;
    }
  }, [activityDate, refresh]);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    void loadSettings();
  }, [loadSettings]);

  const connectCalendar = useCallback(async () => {
    try {
      const result = await readJson(await fetch(`${BRIDGE_URL}/api/calendar/connect`, { method: "POST" }));
      setCalendarConnection(result.calendar || { state: "attention", reason: "status_unavailable" });
      if (result.authorizationUrl) {
        window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
        setNotice("Google 승인 창을 열었어요");
        window.setTimeout(() => { void loadCalendarStatus({ quiet: true }); }, 1_500);
      } else if (result.calendar?.state === "unconfigured") {
        setNotice("Google Calendar 연결 준비가 필요해요");
      } else if (result.calendar?.state === "connected" && result.calendar?.reason === "codex_relay") {
        setNotice("Codex Calendar의 바쁜 시간을 사용 중이에요");
      } else {
        setNotice("캘린더 연결을 시작하지 못했어요");
      }
    } catch { setNotice("캘린더 연결을 시작하지 못했어요"); }
  }, [loadCalendarStatus]);

  const saveSettings = useCallback(async (event) => {
    event.preventDefault();
    if (!settings) return;
    const form = new FormData(event.currentTarget);
    const nextPrivateMode = form.get("privateOverlay") === "on";
    const nextSettings = {
      dayStart: form.get("dayStart"),
      dayEnd: form.get("dayEnd"),
      focusDurations: [50],
      defaultFocusMinutes: 50,
      bufferMinutes: Number(form.get("bufferMinutes")),
    };
    try {
      const result = await readJson(await fetch(`${BRIDGE_URL}/api/schedule-settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextSettings) }));
      setSettings(result.settings);
      setPrivateMode(nextPrivateMode);
      try { localStorage.setItem(OVERLAY_PRIVACY_KEY, String(nextPrivateMode)); } catch { /* local privacy preference is optional */ }
      setSettingsOpen(false);
      await loadSchedule({ rebuild: true, quiet: true });
      setNotice("시간표 설정을 저장했어요");
    } catch { setNotice("설정 값을 확인해 주세요"); }
  }, [loadSchedule, settings]);

  const selectedQuest = useMemo(() => board?.quests?.find((quest) => quest.id === expandedQuestId) || null, [board?.quests, expandedQuestId]);
  if (surface === "overlay") {
    return <NowFocusOverlay
      schedule={schedule}
      nowFocus={nowFocus}
      privateMode={privateMode}
      onOpenDashboard={() => { void openDashboard(); }}
      onReportBlock={(blockId, status) => { void reportBlock(blockId, status); }}
      onRebuild={() => loadSchedule({ rebuild: true })}
      onAddManualTask={addManualTask}
      onMoveBlock={moveBlock}
    />;
  }

  return <div className={styles.shell}>
    <ScheduleDashboard
      schedule={schedule}
      nowFocus={nowFocus}
      calendarCoverage={calendarCoverage}
      calendarConnection={calendarConnection}
      onOpenQuest={toggleQuest}
      onCompleteBlock={(blockId) => { void reportBlock(blockId, "completed"); }}
      onDeferBlock={(blockId) => { void reportBlock(blockId, "deferred"); }}
      onRebuild={() => { void loadSchedule({ rebuild: true }); }}
      onOpenSettings={openSettings}
      onConnectCalendar={connectCalendar}
      onAddManualTask={addManualTask}
    />
    <p className={styles.notice} role="status" data-visible={notice ? "true" : "false"}>{notice}</p>
    {selectedQuest ? <section className={styles.questDetail} aria-label="선택한 작업 상세"><Item quest={selectedQuest} /></section> : null}
    {settingsOpen && settings ? <div className={styles.settingsBackdrop} role="presentation">
      <form className={styles.settingsSheet} onSubmit={saveSettings} aria-label="시간표 설정">
        <header><div><p>시간표 설정</p><strong>오늘의 리듬</strong></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label="설정 닫기">×</button></header>
        <div className={styles.settingsRow}>
          <label>시작 시간<input name="dayStart" type="time" defaultValue={settings.dayStart} required /></label>
          <label>마감 시간<input name="dayEnd" type="time" defaultValue={settings.dayEnd} required /></label>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.fixedSetting}><span>집중 단위</span><strong>00–50분</strong></div>
          <label>완충 시간<select name="bufferMinutes" defaultValue={String(settings.bufferMinutes)}><option value="0">없음</option><option value="5">5분</option><option value="10">10분</option><option value="15">15분</option></select></label>
        </div>
        <label className={styles.checkbox}><input name="privateOverlay" type="checkbox" defaultChecked={privateMode} /><span>오버레이에서 작업명 숨기기</span></label>
        <button className={styles.save} type="submit">저장하고 재배치</button>
      </form>
    </div> : null}
  </div>;
}
