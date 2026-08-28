# Daybridge

Turn session-selected work into a focused, calendar-aware action list.

Daybridge is a local-first desktop companion. It reduces a detailed daily note to a short list of actions that can be started immediately, while keeping the source note read-only and traceable.

## What the first release includes

- A compact Windows floating widget that stays above other windows and lives in the system tray
- A concrete first step and a completion condition for every action
- One-click complete, defer-to-tomorrow, resume, and blocked states
- Local status reports mirrored to an AIHUB handoff when the machine profile is available
- A link back to the evidence that produced each action
- Direct session handoff: whenever the user decides a task belongs on the timetable, the `daybridge-schedule-writer` Skill records it without waiting for a closeout or briefing
- Stable mission and quest IDs for multi-day carryover, with explicit sequential dependencies only when AIHUB declares them
- A validated `daybridge_quest_plan` input contract: 50-minute `focus_units`, no fixed quest times, and a separate confirmation queue
- A cross-session `daybridge-schedule-writer` Skill: another Codex session can upsert normalized work into a date-scoped Markdown inbox, and the bridge automatically re-plans when its fingerprint changes
- Optional time planning: leave the work window blank to use a lightweight untimed “오늘 할 일” list, or set both start and end times to enable the `HH:00–HH:50` timetable
- Freshness, record-quality, and source-coverage indicators instead of invented certainty

## Local development

Requirements: Node.js 22.12 or later and pnpm 11. The native Windows widget additionally needs Rust (MSVC target), Microsoft C++ Build Tools with the Windows SDK, and WebView2.

```bash
pnpm install
pnpm dev
```

개발 중에는 설치 파일을 만들 필요가 없다. `pnpm dev`는 Vite 개발 서버를 실행하며 코드와 스타일을 저장할 때 브라우저 위젯에 변경 사항을 즉시 반영한다. 이 브라우저 미리보기가 가장 빠른 디버깅 경로다. AIHUB 연결과 상태 영수증까지 확인할 때만 별도 터미널에서 `pnpm bridge`를 함께 실행한다.

`pnpm build` runs the strict TypeScript check and creates a production web bundle. The direct session inbox is the normal input path; the optional AIHUB Quest Extractor can still write a derived `*_daybridge_quest_plan.json`, which `pnpm compile:closeout -- --source-date YYYY-MM-DD` can consume for legacy or closeout-driven workflows. `pnpm bridge` starts the local bridge; each status report is written locally and mirrored to AIHUB when the machine profile is available. The packaged Tauri widget also checks the bridge at launch and starts the checkout's `scripts/local-bridge.mjs` without opening a console when it is not already running.

To run the always-on-top shell after the Windows prerequisites are installed:

```bash
pnpm dev:widget
```

`pnpm dev:widget`도 개발 모드라서 저장 시 프런트엔드가 갱신되지만, Rust·MSVC·Windows SDK·WebView2가 필요하다. `pnpm build:widget`은 배포용 설치 파일을 만들 때만 실행한다.

### 세션에서 일정 전달하기

어떤 Codex 세션에서든 사용자가 “이 업무는 시간표에 넣자”고 판단하면 `daybridge-schedule-writer` Skill을 즉시 호출한다. closeout·브리핑 생성은 필요하지 않다. Skill이 업무를 정규화한 뒤 `write_schedule_inbox.py upsert` 명령을 실행하면 파일은 `%LOCALAPPDATA%\Daybridge\inbox\schedule-YYYY-MM-DD.md`에 날짜별로 생성된다. 고정 시각은 전달하지 않으며, Daybridge가 근무시간·점심시간·Google Calendar busy를 합쳐 `HH:00–HH:50` 단위로 배치한다.

시간 설정을 하지 않은 상태에서는 시작·마감 시간을 임의로 채우지 않는다. 이때는 `mode=todo`로 오늘의 작업을 시간 없이 카드 목록으로 보여주며, 날짜별로 안정적인 랜덤 순서를 사용한다. 의존성이 있는 작업은 선행 작업이 먼저 오고, 독립 작업만 섞인다. 작업 카드에는 시간이 없지만 근무일 카운트다운과 18:00 자동 종료는 유지한다. 접힌 위젯에는 목록의 다음 작업 제목과 근무일 카운트다운을 보여준다. 두 시간을 모두 입력하고 저장하면 기존의 `HH:00–HH:50` 시간표 모드로 전환된다.

반영을 확인하려면 local bridge가 실행 중인 상태에서 `GET /api/schedule/inbox?date=YYYY-MM-DD`로 `valid`, `tasks`, `excluded`, `errors`, `fingerprint`를 먼저 확인한다. 이후 위젯의 자동 조회(최대 60초) 또는 `POST /api/schedule/rebuild`로 시간표를 다시 읽는다. 파일 기록 성공은 업무 완료나 사용자의 receipt를 의미하지 않는다.

## Data boundary

Daybridge does not edit the original daily note. A direct session writes only a validated, date-scoped inbox; the optional compiler creates a sanitized quest-board JSON artifact; the app writes status receipts only. AIHUB's `conversation_bridge/daybridge_handoff.py` may collect those receipts during a later closeout, but that closeout is not required for scheduling. See:

- [Architecture](docs/ARCHITECTURE.md)
- [Action-list contract](docs/INTEGRATION_CONTRACT.md)
- [Privacy boundary](docs/PRIVACY.md)
- [Google Calendar connection](docs/GOOGLE_CALENDAR.md)
- [Roadmap](docs/ROADMAP.md)
- [Debugging guide](docs/DEBUGGING.md)
- [Contributing](CONTRIBUTING.md)

## Status

The direct session inbox, deterministic 50-minute scheduler, progress bridge, optional AIHUB handoff, and Tauri widget shell are implemented. The native installer build is blocked on this computer until Rust and the Microsoft C++ Build Tools are installed. Licensing and public release remain separate decisions.

## License

No open-source license has been selected yet. Do not reuse or redistribute the source until a license is added.
