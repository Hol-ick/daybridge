# Daybridge

Turn session-selected work into a focused, calendar-aware action list.

Daybridge is a local-first desktop companion. It reduces a detailed daily note to a short list of actions that can be started immediately, while keeping the source note read-only and traceable.

## What the first release includes

- A compact Windows floating widget that stays above other windows and lives in the system tray
- A concrete first step and a completion condition for every action
- One-click complete, defer-to-tomorrow, resume, and blocked states
- Local status reports mirrored to an MARU handoff when the machine profile is available
- A link back to the evidence that produced each action
- Direct session handoff: whenever the user decides a task belongs on the timetable, the `daybridge-schedule-writer` Skill records it without waiting for a closeout or briefing
- Stable mission and quest IDs for multi-day carryover, with explicit sequential dependencies only when MARU declares them
- A validated `daybridge_quest_plan` input contract: 50-minute `focus_units`, no fixed quest times, and a separate confirmation queue
- A cross-session `daybridge-schedule-writer` Skill: another Codex session can upsert normalized work into a date-scoped Markdown inbox, and the bridge automatically re-plans when its fingerprint changes
- Optional time planning: leave the work window blank to use a lightweight untimed “오늘 할 일” list, or set both start and end times to enable the `HH:00–HH:50` timetable
- Freshness, record-quality, and source-coverage indicators instead of invented certainty

## Local development

### 빠른 메모 (Windows)

Daybridge 실행 중 **Ctrl+D**를 누르면 별도 메모창이 열리고 바로 입력할 수 있다. 트레이의 **메모 열기 (Ctrl+D)**도 같은 창을 연다. 여러 번 눌러도 창을 추가로 만들지 않는다. 저장 오류가 표시되면 창을 유지한 채 **다시 저장**을 누른다.

메모는 입력 영역과 작은 닫기 버튼으로 표시한다. 작성 중 초안을 자동 저장하고 X·Esc·Alt+F4로 닫으면 마지막 입력까지 저장한 뒤 개별 로컬 파일로 보관한다. 다음 Ctrl+D는 빈 메모를 열고, 이미 열린 상태에서는 작성 중인 메모로 돌아온다. 위젯을 펼치면 하단 도구 모음에 ‘메모 보관함’이 표시된다. 이 버튼 또는 트레이의 ‘메모 보관함’에서 닫은 메모를 찾을 수 있다.

관리 창의 X·Alt+F4는 해당 창만 숨긴다. 위젯·트레이·Ctrl+D는 계속 동작하며, 앱을 종료하려면 트레이의 ‘종료’를 사용한다. 메모를 작성 중일 때 명시적으로 종료하면 최종 저장과 보관을 먼저 완료한다.

앱 로컬 데이터 폴더의 `memos/state.json`에 초안을, `memos/archive/`에 UTF-8 보관본을 저장하며 일정·원본 노트·MARU와 동기화하지 않는다. 최대 크기는 UTF-8 기준 1 MiB다. 저장 실패 시 창과 내용을 유지하며, 보관 결과 확인 중에는 편집을 잠그고 닫기 재시도를 제공한다. 비정상 종료 후에는 마지막 저장된 미완료 초안을 복구한다. 기존 `quick-memo.txt`는 원본을 그대로 두고 한 번만 보관함에 이관한다.

저장·보관·복구·실패 로그에는 시각, 메모 식별자, 수정 번호, 바이트 수, 결과·오류 코드만 기록하고 본문은 기록하지 않는다. Ctrl+D는 실행 중 다른 앱의 같은 단축키보다 우선하며, 이미 다른 프로그램이 전역 등록했다면 메모창에 등록 실패를 알린다. Windows 잠금·로그인 화면에서는 사용할 수 없다.

`/?surface=memo`는 브라우저 미리보기다. 브라우저 저장소를 사용하며 Windows 전역 단축키를 등록하지 않는다. 운영 메모와 공유하지 않는다.

Requirements: Node.js 22.12 or later and pnpm 11. The native Windows widget additionally needs Rust (MSVC target), Microsoft C++ Build Tools with the Windows SDK, and WebView2.

```bash
pnpm install
pnpm dev
```

개발 중에는 설치 파일을 만들 필요가 없다. `pnpm dev`는 Vite 개발 서버를 실행하며 코드와 스타일을 저장할 때 브라우저 위젯에 변경 사항을 즉시 반영한다. 이 브라우저 미리보기가 가장 빠른 디버깅 경로다. MARU 연결과 상태 영수증까지 확인할 때만 별도 터미널에서 `pnpm bridge`를 함께 실행한다.

`pnpm build` runs the strict TypeScript check and creates a production web bundle. The direct session inbox is the normal input path; the optional MARU Quest Extractor can still write a derived `*_daybridge_quest_plan.json`, which `pnpm compile:closeout -- --source-date YYYY-MM-DD` can consume for legacy or closeout-driven workflows. `pnpm bridge` starts the local bridge. A user report commits local state, an idempotency receipt and a handoff outbox entry together; optional MARU delivery retries independently. The release widget verifies and starts its bundled Node executable and bridge resources. Only development builds allow a checkout fallback.

To run the always-on-top shell after the Windows prerequisites are installed:

```bash
pnpm dev:widget
```

`pnpm dev:widget`도 개발 모드라서 저장 시 프런트엔드가 갱신되지만, Rust·MSVC·Windows SDK·WebView2가 필요하다. `pnpm build:widget`은 배포용 설치 파일을 만들 때만 실행한다.

### 개발 검증

`pnpm check`는 `src`의 실행 JS·JSX·TS 전체를 엄격하게 검사한다. `pnpm test`는 `src`와 `scripts` 아래의 모든 `.test.mjs`를 찾아 순차 실행하며, 실패한 검사가 있으면 실패 종료값을 반환한다. 브리지 검사는 임시 데이터와 독립 포트를 사용한다. 실제 Calendar 계정이나 운영 데이터는 필요하지 않다.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
cargo test --offline --manifest-path src-tauri/Cargo.toml
```

Windows CI도 같은 웹 검사와 전체 회귀를 실행하고 Rust 검사를 추가한다. 브라우저 mock 검사 실행법과 화면 검증 범위는 [Debugging guide](docs/DEBUGGING.md)를 따른다.

### 세션에서 일정 전달하기

어떤 Codex 세션에서든 사용자가 “이 업무는 시간표에 넣자”고 판단하면 `daybridge-schedule-writer` Skill을 즉시 호출한다. closeout·브리핑 생성은 필요하지 않다. Skill이 업무를 정규화한 뒤 `write_schedule_inbox.py upsert` 명령을 실행하면 파일은 `%LOCALAPPDATA%\Daybridge\inbox\schedule-YYYY-MM-DD.md`에 날짜별로 생성된다. 고정 시각은 전달하지 않으며, Daybridge가 근무시간·점심시간·Google Calendar busy를 합쳐 `HH:00–HH:50` 단위로 배치한다.

시간 설정을 하지 않은 상태에서는 시작·마감 시간을 임의로 채우지 않는다. 이때는 `mode=todo`로 오늘의 작업을 시간 없이 카드 목록으로 보여주며, 날짜별로 안정적인 랜덤 순서를 사용한다. 의존성이 있는 작업은 선행 작업이 먼저 오고, 독립 작업만 섞인다. 접힌 위젯에는 목록의 다음 작업 제목과 근무일 카운트다운을 보여준다. 두 시간을 모두 입력하고 저장하면 기존의 `HH:00–HH:50` 시간표 모드로 전환된다. 현재 구현은 18:00에 앱이나 컴퓨터를 자동 종료하지 않는다. 창 닫기와 tray 종료는 명시적인 앱 종료 요청으로 처리한다.

반영을 확인하려면 local bridge가 실행 중인 상태에서 `GET /api/schedule/inbox?date=YYYY-MM-DD`로 `valid`, `tasks`, `excluded`, `errors`, `fingerprint`를 먼저 확인한다. 이후 위젯의 자동 조회(최대 60초) 또는 `POST /api/schedule/rebuild`로 시간표를 다시 읽는다. 파일 기록 성공은 업무 완료나 사용자의 receipt를 의미하지 않는다.

## Data boundary

Daybridge does not edit the original daily note. A direct session writes only a validated, date-scoped inbox; the optional compiler creates a sanitized quest-board JSON artifact; the app writes status receipts only. MARU's `conversation_bridge/daybridge_handoff.py` may collect those receipts during a later closeout, but that closeout is not required for scheduling. See:

- [Architecture](docs/ARCHITECTURE.md)
- [Action-list contract](docs/INTEGRATION_CONTRACT.md)
- [Privacy boundary](docs/PRIVACY.md)
- [Google Calendar connection](docs/GOOGLE_CALENDAR.md)
- [Roadmap](docs/ROADMAP.md)
- [Debugging guide](docs/DEBUGGING.md)
- [Activity log](docs/ACTIVITY_LOG.md)
- [Contributing](CONTRIBUTING.md)

## Status

As of 2026-10-01, the local storage transaction/recovery, duplicate-request protection, persisted handoff retry, carryover and settings contracts, runtime diagnostics, full regression runner and bundled Windows runtime are implemented. The Windows release executable and NSIS installer build successfully. Executable validation and execution of the extracted installer payload passed in temporary folders with no checkout or system Node in PATH. Actual NSIS installation and Windows login startup remain unverified; the existing operational app and storage configuration have not been replaced. Licensing and public release remain separate decisions.

For the separate executable and installer-payload checks, run `pnpm verify:package` and `pnpm verify:installer` after `pnpm build:widget`. The payload check requires an existing 7-Zip installation. These commands use the explicit native validation mode and produce receipts under ignored `test-artifacts`; they do not install the app. See the debugging guide for the remaining installation verification boundary.

## License

No open-source license has been selected yet. Do not reuse or redistribute the source until a license is added.
