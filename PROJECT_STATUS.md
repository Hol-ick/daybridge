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
- The desktop surface is split into a quiet 288×64 always-on-top overlay and a separately opened management dashboard. Clicking the overlay expands a same-width 288×520 management panel upward while keeping the summary row anchored to the bottom; the panel lists today's blocks with compact complete/defer controls, rebuild, and full-schedule navigation. The collapsed overlay contains only the focus time, task title (or a privacy-safe generic label), a large `HH:MM` leave-time timer when no focus block is active, and completion while work is active. Its transparent, shadowless host no longer paints a larger background rectangle around the card, and the card can be dragged with magnetic corner snapping. The dashboard contains timeline, rebalancing, settings, and task detail.
- Web production build, 41 Node tests, and the dashboard/overlay Playwright smoke flow passed. The smoke flow now exercises the real dashboard command paths for completing a focus block and saving/rebuilding schedule settings, plus the compact overlay's completion acknowledgement. Completed/skipped/deferred blocks are excluded from current-focus resolution, so a successful report immediately advances the card. Rust/Cargo, MSVC, Windows SDK, WebView2가 모두 Tauri 진단에서 확인됐고 `cargo check`가 통과했다. 실제 브리지 재생성 결과도 정각 시작·50분 종료와 짧은 제목을 확인했다.
- 로컬 개발 환경은 설치 프로그램 없이 `pnpm dev:all`로 UI와 bridge를 함께 실행한다. VS Code task/launch 설정은 UI 브라우저 디버그와 Node bridge attach를 제공하며, bridge debugger는 평소 개발 환경과 동시에 실행하지 않는다. 오버레이 카드는 288×64px로 창과 같은 크기이며 모니터 작업 영역 모서리에 여백 없이 정렬된다.
- 오버레이 위치는 Tauri 네이티브 `Moved` 이벤트로 앱 데이터에 저장되고 재실행 때 복원된다. 최초 pointerdown에서 native drag를 시작하며, 저장된 임의 위치는 작업 영역 안으로 보정되고 모서리 64px 이내에서만 자석 정렬된다. 실제 Windows 창 이동·재실행 복원을 확인했다.
- 오버레이 카드는 native 창과 동일한 288×64px로 렌더링한다. 카드와 창의 크기를 일치시켜 모서리 정렬이 시각적으로도 창 끝과 일치한다.
- 오버레이 제목 버튼은 native drag와 분리되어 클릭 시 같은 폭의 관리 패널을 아래쪽 요약 행에서 위로 펼친다. 패널은 하단을 transform 기준으로 삼아 열릴 때 아래→위, 닫힐 때 위→아래 방향을 유지한다. 네이티브 창도 하단을 고정한 채 520px까지 확장하며, 펼침·접힘은 CSS 높이/투명도 애니메이션으로 연결한다. 패널에서는 여유 시간 블록을 제외한 실제 일정만 시간과 할 일을 가로로 크게 보여주고, 블록 완료·미룸·재배치·전체 시간표 열기를 바로 조작할 수 있다. 실제 이동 때만 드래그를 시작하며, 활성 집중 블록이 없을 때 오른쪽 `열기` 버튼 대신 퇴근까지 남은 시간을 `HH:MM` 형식으로 크게 표시한다. 일정 시간이 없는 빈 상태에서는 `시간표 확인` 같은 보조 문구를 숨기고 제목만 남긴다. 타이머는 30초 주기로 갱신된다.

## Current blocker

The Google Calendar runtime connection still requires a user-authorized local OAuth setup; no calendar events will be written. The native toolchain and live overlay drag/restore path are verified; multi-monitor behavior remains observational.

## Next actions

1. Add the read-only Google Calendar OAuth busy-window adapter after the user authorizes a local OAuth client; retain the existing `attention` fallback until then.
2. Start `pnpm bridge` in one terminal and `pnpm dev:widget` in another when changing native window behavior; verify the two Tauri windows, tray actions, lower-right placement, and always-on-top overlay.
3. Observe the next actual AIHUB daily Quest Plan and verify that its current-date tasks create an actionable schedule rather than the empty-state fallback.

## Boundaries and risks

- Original diaries, worklogs, closeout sources, and canonical indexes remain read-only to Daybridge.
- A user click is a status receipt, not independent proof of task completion.
- Calendar integration exposes only busy time ranges to scheduling. Event titles, attendees, descriptions, links, locations, tokens, and credentials are not written to Daybridge or AIHUB artifacts.
- The machine-local Daybridge checkout and Node runtime paths must never enter repository fixtures or shared AIHUB documents.
- Public release, telemetry, cloud sync, authentication, and licensing remain separate decisions.
