import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useAppActions, useAppState } from "./AppContext.jsx";
import { bindOverlayMagnet, currentSurface, placeOverlayInCorner } from "./desktopWindow.js";
import Item from "./todometer/components/Item.jsx";
import NowFocusOverlay from "./schedule/NowFocusOverlay.jsx";
import ScheduleDashboard from "./schedule/ScheduleDashboard.jsx";
import DailyDefaultsEditor from "./schedule/DailyDefaultsEditor.jsx";
import { resolveActivityDate } from "./schedule/activity-date.js";
import { recordRuntimeEvent } from "./runtime-log.js";
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
  if (!response.ok) {
    const error = new Error(`bridge request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function fetchBridge(resource, options) {
  try {
    return await fetch(resource, options);
  } catch (initialError) {
    // The Tauri shell and the local data bridge are intentionally separate
    // processes. If the bridge was terminated after the widget had started,
    // revive it and replay this one user action instead of making the card
    // appear unresponsive until the next full app restart.
    if (!isTauri()) throw initialError;
    try {
      await invoke("ensure_local_bridge");
      return await fetch(resource, options);
    } catch (recoveryError) {
      const error = new Error(`bridge recovery failed: ${recoveryError?.message || String(recoveryError)}`);
      error.cause = initialError;
      throw error;
    }
  }
}

function emptyTodoSchedule(date) {
  return {
    schemaVersion: 1,
    date,
    mode: "todo",
    timeConfigured: false,
    timezone: "Asia/Seoul",
    generatedAt: new Date().toISOString(),
    blocks: [],
    unscheduled: [],
    calendar: { coverage: "attention" },
  };
}

export default function ScheduleSurface() {
  const { board, expandedQuestId } = useAppState();
  const { toggleQuest, refresh } = useAppActions();
  const [surface] = useState(currentSurface);
  const [schedule, setSchedule] = useState(null);
  const [nowFocus, setNowFocus] = useState(null);
  const [calendarCoverage, setCalendarCoverage] = useState("attention");
  const [calendarConnection, setCalendarConnection] = useState({ state: "attention", reason: "status_pending" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overlayMagnetPulse, setOverlayMagnetPulse] = useState(false);
  const [privateMode, setPrivateMode] = useState(initialPrivateMode);
  const [notice, setNotice] = useState("");
  const [refreshingWidget, setRefreshingWidget] = useState(false);
  const [dailyDefaultsDraft, setDailyDefaultsDraft] = useState([]);
  const [dailyDefaultsLoaded, setDailyDefaultsLoaded] = useState(false);
  const [dailyDefaultsLoading, setDailyDefaultsLoading] = useState(false);
  // The overlay always represents today. A board persisted while the bridge
  // was unavailable must not pin schedule requests to yesterday's date.
  const activityDate = resolveActivityDate(board, kstDate());

  useEffect(() => {
    document.body.dataset.surface = surface;
    recordRuntimeEvent("surface_mounted", { surface });
    return () => { delete document.body.dataset.surface; };
  }, [surface]);

  const loadSchedule = useCallback(async ({ rebuild = false, quiet = false } = {}) => {
    const requestDate = activityDate;
    recordRuntimeEvent("schedule_load_start", { date: requestDate, rebuild, quiet });
    try {
      const request = rebuild
        ? fetchBridge(`${BRIDGE_URL}/api/schedule/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: requestDate }) })
        : fetchBridge(`${BRIDGE_URL}/api/schedule?date=${requestDate}`);
      const result = await readJson(await request);
      if (!result?.schedule) throw new Error("schedule payload missing");
      setSchedule(result.schedule);
      setNowFocus(result.nowFocus);
      setCalendarCoverage(result.schedule?.calendar?.coverage || "attention");
      recordRuntimeEvent("schedule_load_success", { date: requestDate, rebuild, blocks: Array.isArray(result.schedule?.blocks) ? result.schedule.blocks.length : 0, focusBlocks: Array.isArray(result.schedule?.blocks) ? result.schedule.blocks.filter((block) => block?.type === "focus").length : 0, nowFocus: result.nowFocus?.state || "none" });
      if (!quiet) setNotice(rebuild ? "오늘 남은 시간을 다시 배치했어요" : "");
      return result;
    } catch (error) {
      recordRuntimeEvent("schedule_load_error", { date: requestDate, rebuild, error: error?.message || String(error) });
      // A date with no board is a normal empty-todo state, not a reason to
      // retain yesterday's cards. Retaining them made their status requests
      // target today's missing board and appear to ignore card clicks.
      if (error?.status === 404) {
        setSchedule(emptyTodoSchedule(requestDate));
        setNowFocus({ state: "todo_list", block: null, nextFocus: null });
        setCalendarCoverage("attention");
        recordRuntimeEvent("schedule_cleared_for_missing_date", { date: requestDate, rebuild });
        if (!quiet) setNotice("오늘 일정이 없습니다. + 버튼으로 추가할 수 있어요");
        return { schedule: emptyTodoSchedule(requestDate), nowFocus: { state: "todo_list", block: null, nextFocus: null } };
      }
      if (!quiet) setNotice("시간표를 불러오지 못했어요");
      return null;
    }
  }, [activityDate]);

  const addManualTask = useCallback(async ({ title }) => {
    try {
      const result = await readJson(await fetchBridge(`${BRIDGE_URL}/api/quests/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityDate, title }),
      }));
      setSchedule(result.schedule);
      setNowFocus(result.nowFocus);
      await refresh();
      recordRuntimeEvent("manual_task_added", { date: activityDate, title });
      setNotice(`${title}을 오늘 할 일에 추가했어요`);
      return true;
    } catch (error) {
      recordRuntimeEvent("manual_task_add_error", { date: activityDate, title, error: error?.message || String(error) });
      setNotice("작업을 추가하지 못했어요. 제목을 확인해 주세요");
      return false;
    }
  }, [activityDate, refresh]);

  const loadCalendarStatus = useCallback(async ({ quiet = false } = {}) => {
    try {
      const result = await readJson(await fetchBridge(`${BRIDGE_URL}/api/calendar/status`));
      if (!result?.calendar) throw new Error("calendar payload missing");
      setCalendarConnection(result.calendar || { state: "attention", reason: "status_unavailable" });
      recordRuntimeEvent("calendar_status", { state: result.calendar?.state, reason: result.calendar?.reason });
      return result.calendar;
    } catch (error) {
      recordRuntimeEvent("calendar_status_error", { error: error?.message || String(error) });
      if (!quiet) setNotice("캘린더 연결 상태를 확인하지 못했어요");
      return null;
    }
  }, []);

  const loadDailyDefaults = useCallback(async () => {
    if (dailyDefaultsLoading) return false;
    setDailyDefaultsLoading(true);
    try {
      const result = await readJson(await fetchBridge(`${BRIDGE_URL}/api/daily-defaults`));
      const routines = Array.isArray(result?.dailyDefaults?.routines) ? result.dailyDefaults.routines : [];
      setDailyDefaultsDraft(routines);
      setDailyDefaultsLoaded(true);
      return true;
    } catch (error) {
      recordRuntimeEvent("daily_defaults_load_error", { error: error?.message || String(error), surface });
      setNotice("매일 기본 일정을 불러오지 못했어요");
      return false;
    } finally {
      setDailyDefaultsLoading(false);
    }
  }, [dailyDefaultsLoading, surface]);

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
    if (surface !== "overlay" || !isTauri() || import.meta.env.DEV) return undefined;
    let disposed = false;
    const ensureVisible = async () => {
      try {
        await invoke("show_overlay");
      } catch (error) {
        if (!disposed) {
          recordRuntimeEvent("overlay_visibility_check_error", { error: error?.message || String(error) });
        }
      }
    };
    // A transparent always-on-top window can be covered by a display or
    // full-screen transition without the process or WebView terminating.
    // Reassert visibility/z-order without taking focus from the active app.
    void ensureVisible();
    const intervalId = window.setInterval(ensureVisible, 15_000);
    document.addEventListener("visibilitychange", ensureVisible);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", ensureVisible);
    };
  }, [surface]);
  useEffect(() => {
    if (surface !== "overlay") return undefined;
    let disposed = false;
    let cleanup;
    let pulseTimer = null;
    const pulseOnSnap = () => {
      if (disposed) return;
      setOverlayMagnetPulse(false);
      window.requestAnimationFrame(() => {
        if (!disposed) setOverlayMagnetPulse(true);
      });
      if (pulseTimer) window.clearTimeout(pulseTimer);
      pulseTimer = window.setTimeout(() => {
        if (!disposed) setOverlayMagnetPulse(false);
      }, 360);
    };
    void bindOverlayMagnet({ onSnap: pulseOnSnap }).then((dispose) => {
      if (disposed) dispose();
      else cleanup = dispose;
    });
    return () => {
      disposed = true;
      if (pulseTimer) window.clearTimeout(pulseTimer);
      setOverlayMagnetPulse(false);
      cleanup?.();
    };
  }, [surface]);

  const reportBlock = useCallback(async (blockId, status) => {
    const displayedDate = typeof schedule?.date === "string" ? schedule.date : "";
    // The midnight refresh and the user's click can overlap. Never send an
    // action for a card rendered from a different day's schedule.
    if (displayedDate && displayedDate !== activityDate) {
      recordRuntimeEvent("schedule_block_report_stale_date", { displayedDate, requestedDate: activityDate, blockId, status });
      setSchedule(emptyTodoSchedule(activityDate));
      setNowFocus({ state: "todo_list", block: null, nextFocus: null });
      setNotice("날짜가 바뀌어 오늘 일정을 불러오는 중이에요");
      void loadSchedule({ quiet: true });
      return false;
    }
    try {
      const result = await readJson(await fetchBridge(`${BRIDGE_URL}/api/schedule/block-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityDate, blockId, status, note: status === "completed" ? "집중 블록 완료" : "집중 블록을 다음으로 미룸" }),
      }));
      setSchedule(result.schedule);
      setNowFocus(result.nowFocus);
      setNotice(status === "completed" ? "집중 시간을 완료했어요" : "이 작업은 다음 계획으로 넘겼어요");
      recordRuntimeEvent("schedule_block_reported", { date: activityDate, blockId, status });
      void refresh();
      return true;
    } catch (error) {
      recordRuntimeEvent("schedule_block_report_error", { date: activityDate, blockId, status, error: error?.message || String(error) });
      setNotice("진행 상태를 저장하지 못했어요");
      return false;
    }
  }, [activityDate, loadSchedule, refresh, schedule]);

  const moveBlock = useCallback(async (blockId, targetBlockId, position) => {
    try {
      const result = await readJson(await fetchBridge(`${BRIDGE_URL}/api/schedule/block-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityDate, blockId, targetBlockId, position }),
      }));
      setSchedule(result.schedule);
      setNowFocus(result.nowFocus);
      setNotice("시간표 위치를 바꿨어요");
      recordRuntimeEvent("schedule_block_moved", { date: activityDate, blockId, targetBlockId, position });
      void refresh();
      return true;
    } catch (error) {
      recordRuntimeEvent("schedule_block_move_error", { date: activityDate, blockId, targetBlockId, position, error: error?.message || String(error) });
      setNotice("목록 안에서만 순서를 바꿀 수 있어요");
      return false;
    }
  }, [activityDate, refresh]);

  const discardBlock = useCallback(async (blockId) => {
    try {
      const result = await readJson(await fetchBridge(`${BRIDGE_URL}/api/schedule/block-discard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityDate, blockId }),
      }));
      setSchedule(result.schedule);
      setNowFocus(result.nowFocus);
      setNotice("작업을 오늘 시간표에서 폐기했어요");
      recordRuntimeEvent("schedule_block_discarded", { date: activityDate, blockId });
      void refresh();
      return true;
    } catch (error) {
      recordRuntimeEvent("schedule_block_discard_error", { date: activityDate, blockId, error: error?.message || String(error) });
      setNotice("이 작업을 폐기하지 못했어요");
      return false;
    }
  }, [activityDate, refresh]);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    if (!dailyDefaultsLoaded) void loadDailyDefaults();
  }, [dailyDefaultsLoaded, loadDailyDefaults]);

  const refreshWidget = useCallback(async () => {
    if (refreshingWidget) return;
    setRefreshingWidget(true);
    try {
      if (isTauri()) await invoke("show_overlay");
      const [scheduleResult, calendarResult] = await Promise.all([
        loadSchedule({ quiet: true }),
        loadCalendarStatus({ quiet: true }),
      ]);
      if (!scheduleResult || !calendarResult) throw new Error("refresh data unavailable");
      recordRuntimeEvent("overlay_manual_refresh", { source: "settings", surface });
      setNotice("위젯을 새로고침했어요");
    } catch (error) {
      recordRuntimeEvent("overlay_manual_refresh_error", { source: "settings", surface, error: error?.message || String(error) });
      setNotice("위젯을 새로고침하지 못했어요");
    } finally {
      setRefreshingWidget(false);
    }
  }, [loadCalendarStatus, loadSchedule, refreshingWidget, surface]);

  const connectCalendar = useCallback(async () => {
    try {
      const result = await readJson(await fetchBridge(`${BRIDGE_URL}/api/calendar/connect`, { method: "POST" }));
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
    const form = new FormData(event.currentTarget);
    const nextPrivateMode = form.get("privateOverlay") === "on";
    setPrivateMode(nextPrivateMode);
    try { localStorage.setItem(OVERLAY_PRIVACY_KEY, String(nextPrivateMode)); } catch { /* local privacy preference is optional */ }
    if (!dailyDefaultsLoaded) {
      setNotice("매일 기본 일정을 불러오는 중이에요");
      return;
    }
    try {
      const result = await readJson(await fetchBridge(`${BRIDGE_URL}/api/daily-defaults`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityDate, dailyDefaults: { routines: dailyDefaultsDraft } }),
      }));
      setDailyDefaultsDraft(Array.isArray(result?.dailyDefaults?.routines) ? result.dailyDefaults.routines : []);
      if (result.schedule) {
        setSchedule(result.schedule);
        setNowFocus(result.nowFocus);
      }
      setSettingsOpen(false);
      setNotice("매일 기본 일정을 저장했어요");
    } catch (error) {
      recordRuntimeEvent("daily_defaults_save_error", { error: error?.message || String(error), surface });
      setNotice("매일 기본 일정을 저장하지 못했어요");
    }
  }, [activityDate, dailyDefaultsDraft, dailyDefaultsLoaded, surface]);

  const selectedQuest = useMemo(() => board?.quests?.find((quest) => quest.id === expandedQuestId) || null, [board?.quests, expandedQuestId]);
  if (surface === "overlay") {
    return <NowFocusOverlay
      schedule={schedule}
      nowFocus={nowFocus}
      privateMode={privateMode}
      onReportBlock={(blockId, status) => { void reportBlock(blockId, status); }}
      onAddManualTask={addManualTask}
      onMoveBlock={moveBlock}
      onDiscardBlock={discardBlock}
      settingsOpen={settingsOpen}
      onOpenSettings={openSettings}
      onCloseSettings={() => setSettingsOpen(false)}
      onSaveSettings={saveSettings}
      onRefreshWidget={refreshWidget}
      refreshingWidget={refreshingWidget}
      dailyDefaults={dailyDefaultsDraft}
      onDailyDefaultsChange={setDailyDefaultsDraft}
      dailyDefaultsLoading={dailyDefaultsLoading || !dailyDefaultsLoaded}
      magnetPulse={overlayMagnetPulse}
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
      onOpenSettings={openSettings}
      onConnectCalendar={connectCalendar}
      onAddManualTask={addManualTask}
    />
    <p className={styles.notice} role="status" data-visible={notice ? "true" : "false"}>{notice}</p>
    {selectedQuest ? <section className={styles.questDetail} aria-label="선택한 작업 상세"><Item quest={selectedQuest} /></section> : null}
    {settingsOpen ? <div className={styles.settingsBackdrop} role="presentation">
      <form className={styles.settingsSheet} onSubmit={saveSettings} aria-label="위젯 설정">
        <header><div><p>WIDGET</p><strong>표시 옵션</strong></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label="설정 닫기">×</button></header>
        <label className={styles.checkbox}><input name="privateOverlay" type="checkbox" defaultChecked={privateMode} /><span>오버레이에서 작업명 숨기기</span></label>
        <button className={styles.utility} type="button" onClick={refreshWidget} disabled={refreshingWidget} data-testid="schedule-widget-refresh">{refreshingWidget ? "새로고침 중…" : "위젯 새로고침"}</button>
        <DailyDefaultsEditor value={dailyDefaultsDraft} onChange={setDailyDefaultsDraft} loading={dailyDefaultsLoading || !dailyDefaultsLoaded} />
        <button className={styles.save} type="submit" disabled={dailyDefaultsLoading || !dailyDefaultsLoaded}>저장</button>
      </form>
    </div> : null}
  </div>;
}
