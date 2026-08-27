# 2026-08-27 — Runtime event logging and disappearance analysis

## 현상

The user reported that the floating widget had disappeared after being used
normally. The packaged process was absent at the time of the first report and
there was no application-owned event log to distinguish an intentional exit
from a crash or a bridge/rendering failure.

## 조사 근거

- `ScheduleSurface` contains an explicit packaged-overlay exit path when
  `getWorkdayCountdown(new Date()).phase === "after_work"`.
- The native `exit_app` command previously called `app.exit(0)` without a
  reason or durable record.
- Windows Application Error/Windows Error Reporting logs contained no
  Daybridge crash record in the inspected period.
- The Windows Run entry starts Daybridge at login, but it does not relaunch an
  app that intentionally exits at 18:00 while the user session remains open.
- The new runtime probe showed the rebuilt app starting and loading today's
  inbox-backed schedule successfully.

## Root-cause assessment

The most strongly supported explanation is the intentional after-work exit
requested earlier. A second possibility—WebView or bridge failure—could not be
retrospectively excluded because the old build had no event log. It is now
distinguishable on the next occurrence.

## Change

- Added sanitized NDJSON logging for native app lifecycle and exit reasons at
  `%APPDATA%\\com.daybridge.widget\\logs\\runtime-events.ndjson`.
- Added UI events for WebView boot, surface mount, board/schedule loads,
  bridge errors, calendar status, block actions, and the auto-exit trigger.
- Added bridge events at `%LOCALAPPDATA%\\Daybridge\\logs\\bridge-events.ndjson`
  for startup, board reads, schedule reads, client events, and process errors.
- Documented the event interpretation order in `docs/DEBUGGING.md`.

## Verification

- Native log contains `webview_boot`, `app_started`, `surface_mounted`,
  `schedule_load_start`, `schedule_load_success`, and
  `board_refresh_success` for the current run.
- Bridge log contains `bridge_started`, `board_read`, and `schedule_read` with
  today's date, a valid inbox, and the accepted task count.
- Full Node regression suite: 63 passed.
- TypeScript/Vite build and Tauri Windows release build: passed.
