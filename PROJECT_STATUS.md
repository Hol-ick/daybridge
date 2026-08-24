# Daybridge Project Status

- Status: active
- Last updated: 2026-08-24 KST
- Repository: https://github.com/Hol-ick/daybridge

## Objective

Turn AIHUB's evidence-linked daily work and learning candidates into a calm Windows timetable widget. It must show one actionable "do this now" focus block while respecting the user's Google Calendar availability without changing the original notes or calendar by default.

## Current milestone

The schedule-first web foundation is implemented: detailed closeout → Quest Plan → task candidates + calendar-availability seam → carryover-aware `DailySchedule` → current-focus timetable widget. The Google Calendar OAuth adapter remains pending; until it is connected, the schedule explicitly reports calendar coverage as `attention` and assumes no imported busy windows.

## Verified progress

- The Quest Extractor keeps the full closeout as source evidence, removes the fixed three-item limit, classifies user execution/review/decision work, and keeps automation/Codex/policy items in an auditable excluded list.
- Missions and quests use stable IDs. The compiler preserves step receipts and increments carryover when unfinished work reaches a new board date.
- Explicit `depends_on` and sequential execution lock only the declared next step; independent quests remain parallel.
- The AIHUB closeout runner now creates the derived Quest Plan before compiling the following business day's local board.
- Daybridge continuation is completion-driven: the closeout automation invokes `daybridge_continuation.py` after a ready packet, so a closeout that runs past ten minutes is not skipped by a fixed-time follow-up.
- The desktop surface shows compact parent quest cards; clicking one expands a full-width detail area below that card's action row with its summary, done-when line, and compact sub-quest cards. Only one parent card can be open at a time.
- The former Daybridge-specific card renderer has been replaced by an adapted todometer React renderer: its progress meter, dark palette, task-card rhythm, CSS-module structure, SVG controls, and completion response are used directly. Daybridge keeps the quest adapter, parent/sub-quest data model, AIHUB bridge, and Tauri shell around that renderer. The reuse boundary and attribution are recorded in `THIRD_PARTY_NOTICES.md`.
- Manual status, check-in, source, achievement, project, XP, and connection-copy UI remain hidden. The compact card supports progress, completion, `내일 계속`, resume, and sequential sub-quest receipts.
- The accordion unfold, staggered sub-quest reveal, and completion response respect reduced-motion preference. The isolated browser smoke check confirms the collapsed default, single-card expansion, sub-quest completion, and absence of removed controls.
- The Tauri shell defines a transparent frameless always-on-top window plus tray show/hide/quit behavior. Closing the window hides it to the tray.
- TypeScript, production Vite build, compiler tests, runner/profile self-tests, local bridge syntax, and browser smoke/visual checks passed. The card-deck smoke check was run against an isolated preview fixture.
- A schedule-first implementation plan now defines a deep `DailySchedule` module, Google Calendar busy-only read adapter, local-only schedule persistence, and a single current-focus card. Calendar writes are intentionally out of scope until the user explicitly asks for them.
- `DailySchedule` now has a tested Korea-time scheduler: must/should/could ordering, explicit dependencies, fixed hourly focus blocks (`HH:00–HH:50`), transition buffers, carryover, locked work, unscheduled reasons, and current-focus resolution.
- The schedule boundary compacts briefing prose into short action labels such as `리눅스 학습`, `Kiosk 주문 검증`, and `고객 택배 접수 검증`; source quest detail remains on the board.
- The local bridge lazily creates and atomically stores daily schedules, exposes schedule/rebuild/settings/block-report endpoints, and mirrors only sanitized block receipts to AIHUB.
- The desktop surface is split into a quiet 256×58 always-on-top overlay and a separately opened management dashboard. The overlay contains only the focus time, task title (or a privacy-safe generic label), and completion. Its transparent host no longer paints a larger background rectangle around the card, and the card can be dragged with magnetic corner snapping. The dashboard contains timeline, rebalancing, settings, and task detail.
- Web production build, 40 Node tests, and the dashboard/overlay Playwright smoke flow passed. Rust/Cargo, MSVC, Windows SDK, WebView2가 모두 Tauri 진단에서 확인됐고 `cargo check`가 통과했다. 실제 브리지 재생성 결과도 정각 시작·50분 종료와 짧은 제목을 확인했다.
- 로컬 개발 환경은 설치 프로그램 없이 `pnpm dev:all`로 UI와 bridge를 함께 실행한다. VS Code task/launch 설정은 UI 브라우저 디버그와 Node bridge attach를 제공하며, bridge debugger는 평소 개발 환경과 동시에 실행하지 않는다.

## Current blocker

The Google Calendar runtime connection still requires a user-authorized local OAuth setup; no calendar events will be written. The native toolchain is ready, but the overlay/tray behavior has not yet been exercised in a live Tauri development window.

## Next actions

1. Add the read-only Google Calendar OAuth busy-window adapter after the user authorizes a local OAuth client; retain the existing `attention` fallback until then.
2. Start `pnpm bridge` in one terminal and `pnpm dev:widget` in another, then verify the two Tauri windows, tray actions, lower-right placement, and always-on-top overlay.
3. Observe the next actual AIHUB daily Quest Plan and verify that its current-date tasks create an actionable schedule rather than the empty-state fallback.

## Boundaries and risks

- Original diaries, worklogs, closeout sources, and canonical indexes remain read-only to Daybridge.
- A user click is a status receipt, not independent proof of task completion.
- Calendar integration exposes only busy time ranges to scheduling. Event titles, attendees, descriptions, links, locations, tokens, and credentials are not written to Daybridge or AIHUB artifacts.
- The machine-local Daybridge checkout and Node runtime paths must never enter repository fixtures or shared AIHUB documents.
- Public release, telemetry, cloud sync, authentication, and licensing remain separate decisions.
