# Daybridge Project Status

- Status: active
- Last updated: 2026-08-25 KST
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
- The desktop surface is split into a quiet 288×64 always-on-top overlay and a separately opened management dashboard. Clicking the overlay expands a same-width 288×520 management panel upward while keeping the summary row anchored to the bottom; the panel lists today's blocks with one-line marquee titles and leaves only two compact bottom tools: a half-width `+` manual-task button and a half-width gear settings button. The expanded panel has no visible collapse button, and overlay cards no longer expose complete/defer buttons. The collapsed overlay contains only the focus time, task title (or a privacy-safe generic label), and a large `HH:MM` leave-time timer. Its transparent, shadowless host no longer paints a larger background rectangle around the card, and the card can be dragged with magnetic corner snapping. The dashboard contains timeline, rebalancing, settings, and task detail.
- Web production build, 55 Node tests, and the dashboard/overlay Playwright smoke flow passed. Smoke는 대시보드에서 수동 작업을 100분으로 추가하고 저장 후 폼이 닫히는 실제 command path까지 확인하며, 오버레이에서 포인터 기반 시간표 카드 드래그·FLIP 순서 이동·한 줄 marquee·버튼 제거·동일 높이 휴지통·`+`·`⚙` 설정 모달까지 확인한다. Completed/skipped/deferred blocks are excluded from current-focus resolution, so a successful report immediately advances the card. Rust/Cargo, MSVC, Windows SDK, WebView2가 모두 Tauri 진단에서 확인됐고 `cargo check`가 통과했다. 실제 브리지 재생성 결과도 정각 시작·50분 종료와 짧은 제목을 확인했다.
- 로컬 개발 환경은 설치 프로그램 없이 `pnpm dev:all`로 UI와 bridge를 함께 실행한다. VS Code task/launch 설정은 UI 브라우저 디버그와 Node bridge attach를 제공하며, bridge debugger는 평소 개발 환경과 동시에 실행하지 않는다. 오버레이 카드는 288×64px로 창과 같은 크기이며 모니터 작업 영역 모서리에 여백 없이 정렬된다.
- 배포 빌드만 현재 사용자 계정의 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Daybridge`에 자기 실행 파일 경로를 등록한다. 개발 빌드는 로컬 Vite 서버 의존성 때문에 시작 프로그램에 등록하지 않으며, 배포본을 한 번 실행하면 재로그인 때 위젯이 자동으로 시작된다.
- 배포용 오버레이 webview는 로컬 시각 `18:00`을 감시하고, 퇴근 시각이 되면 Tauri `exit_app` 명령으로 트레이에 숨겨진 상태까지 포함한 Daybridge 프로세스 전체를 종료한다. 18시 이후 실행된 배포본은 즉시 종료하며, 개발 모드에는 적용하지 않는다.
- 오버레이 위치는 Tauri 네이티브 `Moved` 이벤트로 앱 데이터에 저장되고 재실행 때 복원된다. 최초 pointerdown에서 native drag를 시작하며, 저장된 임의 위치는 작업 영역 안으로 보정되고 모서리 64px 이내에서만 자석 정렬된다. 실제 Windows 창 이동·재실행 복원을 확인했다.
- 오버레이 카드는 native 창과 동일한 288×64px로 렌더링한다. 카드와 창의 크기를 일치시켜 모서리 정렬이 시각적으로도 창 끝과 일치한다.
- 확장 애니메이션에서는 오버레이 호스트가 네이티브 창 전체를 채우고 카드 자체를 하단에 붙인다. 열 때 네이티브 창을 먼저 520px로 키운 뒤 카드 높이를 64→520px로 늘려 상단만 위로 이동시키고, 닫을 때는 카드가 먼저 520→64px로 접힌 뒤 네이티브 창을 줄인다.
- 오버레이는 드래그 카드 전체를 텍스트 선택 불가로 설정하고 pointerdown 때 남은 브라우저 선택 영역을 지워, 제목이 선택된 채 고정되는 상태를 막는다.
- 288px 오버레이의 작은 실물 크기를 기준으로 접힌 제목·펼친 일정명을 17px, 시작 시각을 12/17px, 퇴근 카운트다운을 27px로 키우고 행·footer 여백을 줄여 전체 64/520px 크기와 하단 고정을 유지한다.
- 시간표 기본 창은 `09:00–18:00`으로 맞추고, 카운트다운 경계는 오전 `09:00`, 점심 `11:30`, 오후 `13:00`, 퇴근 `18:00`을 사용한다. 기존 로컬 기본 설정도 `18:00`으로 마이그레이션했다.
- 활성 집중 일정이 없을 때 오버레이는 기존 `다음 집중 시간 준비 중` 문구를 없애고 왼쪽 제목 슬롯에 경계 라벨, 오른쪽 고정 슬롯에 큰 시간을 배치해 `점심시간까지 02:16`처럼 읽히게 한다. 제목 폭은 타이머 영역을 침범하지 않으며, 긴 제목은 내부 marquee로 이동한다. `block: null` 응답은 실제 빈 상태로 해석한다.
- 오버레이 확장 패널과 전체 시간표의 `작업 추가`에서 제목과 `50·100·150분`을 입력할 수 있다. 수동 작업은 현재 날짜 보드에 `수동 추가` 출처로 저장되고, 저장 즉시 시간표를 재생성해 50분 단위 블록 여러 개로 남은 시간에 배치한다. 브리지는 수동 추가 이벤트도 민감정보를 제거한 receipt로 AIHUB handoff sink에 미러링한다.
- 스케줄러는 기본 `11:30–13:00` 점심시간을 숨겨진 busy 블록으로 예약하고, `09:00–11:30`과 `13:00–18:00` 안의 `HH:00–HH:50` 단위만 작업 슬롯으로 만든다. 오래된 점심 겹침 배치는 재생성 때 버리고 합법적인 슬롯으로 옮기며, 오버레이·대시보드에는 점심/여유 블록을 작업 카드로 표시하지 않는다.
- 확장 카드는 상단에 시작 시각, 하단에 한 줄 작업명을 배치한다. 열려 있는 집중 카드만 mouse/pointer 공통 문서 이벤트와 방향키로 순서를 바꿀 수 있고, 브리지는 완료·보류·캘린더·점심 블록을 이동 대상으로 거부한 뒤 새 순서에 `locked/userPositioned`를 기록하고 sanitized `schedule_block_moved` receipt를 미러링한다. 카드 전체를 클릭하거나 Enter/Space로 누르면 `미완료 → 진행 중 → 완료 → 보류` 상태가 순환되고 즉시 상태 receipt를 보낸다.
- 확장 카드의 시간은 윗줄에, 작업명은 한 줄 marquee로 아랫줄에 표시해 긴 제목도 카드 폭을 넘지 않고 이동하며 읽을 수 있다. Tauri에서 HTML5 drag가 누락되는 경계를 피하도록 mouse/pointer 이동을 직접 추적해 카드 드래그를 시작·drop하고, 카드 자체는 `min-width:0`과 `overflow:hidden`으로 목록 너비를 절대 침범하지 않는다. 드래그 중에는 원본 자리를 점선 슬롯으로 남기고 마우스 좌표를 따라가는 회전·그림자 고스트 카드와 `이동 중` 표시를 렌더링한다. 고스트가 놓일 대상 카드는 펄스·상승·확대 애니메이션을 적용하고, 앞/뒤 삽입 위치를 초록색 라인으로 표시한다. 드롭이 확정되면 새 DOM 순서를 FLIP으로 측정해 source/target과 주변 카드가 서로의 실제 위치까지 이동하고, target은 삽입 방향으로 자리를 만드는 짧은 강조 모션을 재생한다. 하단에는 드래그한 카드와 같은 실제 높이의 휴지통 카드가 나타나며, 놓으면 해당 50분 단위만 오늘 시간표에서 폐기하고 `discardedBlocks`로 보존해 재배치 때 다시 생성하지 않는다. 오버레이에서 `미룸`·`완료`·`접기` 버튼은 제거했고, 하단 도구는 `+` 수동 추가와 `⚙` 설정 모달만 남겼다.
- packaged Tauri origin(`http(s)://tauri.localhost`, `tauri://localhost`)을 로컬 브리지 CORS 허용 목록에 포함해 release 위젯에서도 수동 작업 POST·상태 보고가 차단되지 않는다. 확장 패널은 `오늘 일정 0/0` 헤더를 제거했으며, 바깥 pointerdown과 native window blur에서 자동으로 접힌다. 빈 상태와 수동 입력의 대비·포커스·오류 피드백을 보강했다.
- 오버레이 제목 버튼은 native drag와 분리되어 클릭 시 같은 폭의 관리 패널을 아래쪽 요약 행에서 위로 펼친다. 패널은 하단을 transform 기준으로 삼아 열릴 때 아래→위, 닫힐 때 위→아래 방향을 유지한다. 네이티브 창도 하단을 고정한 채 520px까지 확장하며, 펼침·접힘은 CSS 높이/투명도 애니메이션으로 연결한다. 패널에서는 여유 시간 블록을 제외한 실제 일정만 시작 시각과 할 일을 가로로 크게 보여주고, 각 일정은 `17:00`처럼 종료 시각 없이 시작 시각만 16px로 강조한다. 하단 `+`는 수동 작업 폼을, `⚙`는 기존 시간표 설정 저장·재배치 모달을 연다. 실제 이동 때만 드래그를 시작하며, 활성 집중 블록이 없을 때 오전에는 `09:00→11:30`, 점심에는 `11:30→13:00`, 오후에는 `13:00→18:00` 구간의 다음 경계까지 남은 시간을 `HH:MM` 형식으로 크게 표시한다. 일정 시간이 없는 빈 상태에서는 `시간표 확인` 같은 보조 문구를 숨기고 제목만 남긴다. 타이머는 30초 주기로 갱신된다.

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
