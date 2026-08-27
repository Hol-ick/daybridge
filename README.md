# Daybridge

Turn daily notes into a focused next-day action list.

Daybridge is a local-first desktop companion. It reduces a detailed daily note to a short list of actions that can be started immediately, while keeping the source note read-only and traceable.

## What the first release includes

- A compact Windows floating widget that stays above other windows and lives in the system tray
- A concrete first step and a completion condition for every action
- One-click complete, defer-to-tomorrow, resume, and blocked states
- Local status reports mirrored to an AIHUB handoff when the machine profile is available
- A link back to the evidence that produced each action
- Detailed closeout plus a separate Quest Extractor: every eligible atomic quest is retained, while system/automation work is excluded with a reason
- Stable mission and quest IDs for multi-day carryover, with explicit sequential dependencies only when AIHUB declares them
- A validated `daybridge_quest_plan` input contract: 50-minute `focus_units`, no fixed quest times, and a separate confirmation queue
- A cross-session `daybridge-schedule-writer` Skill: another Codex session can upsert normalized work into a date-scoped Markdown inbox, and the bridge automatically re-plans when its fingerprint changes
- Freshness, record-quality, and source-coverage indicators instead of invented certainty

## Local development

Requirements: Node.js 22.12 or later and pnpm 11. The native Windows widget additionally needs Rust (MSVC target), Microsoft C++ Build Tools with the Windows SDK, and WebView2.

```bash
pnpm install
pnpm dev
```

개발 중에는 설치 파일을 만들 필요가 없다. `pnpm dev`는 Vite 개발 서버를 실행하며 코드와 스타일을 저장할 때 브라우저 위젯에 변경 사항을 즉시 반영한다. 이 브라우저 미리보기가 가장 빠른 디버깅 경로다. AIHUB 연결과 상태 영수증까지 확인할 때만 별도 터미널에서 `pnpm bridge`를 함께 실행한다.

`pnpm build` runs the strict TypeScript check and creates a production web bundle. The AIHUB Quest Extractor first writes a derived `*_daybridge_quest_plan.json`; `pnpm compile:closeout -- --source-date YYYY-MM-DD` consumes that plan and writes the next-business-day board to the local Daybridge data directory. `pnpm bridge` starts the local bridge; each status report is written locally and mirrored to AIHUB when the machine profile is available.

To run the always-on-top shell after the Windows prerequisites are installed:

```bash
pnpm dev:widget
```

`pnpm dev:widget`도 개발 모드라서 저장 시 프런트엔드가 갱신되지만, Rust·MSVC·Windows SDK·WebView2가 필요하다. `pnpm build:widget`은 배포용 설치 파일을 만들 때만 실행한다.

### 세션에서 일정 전달하기

다른 Codex 세션에서 AIHUB closeout·브리핑을 `daybridge-schedule-writer` Skill로 정규화한 뒤, Skill의 `write_schedule_inbox.py upsert` 명령을 실행한다. 파일은 `%LOCALAPPDATA%\Daybridge\inbox\schedule-YYYY-MM-DD.md`에 날짜별로 생성된다. 고정 시각은 전달하지 않으며, Daybridge가 근무시간·점심시간·Google Calendar busy를 합쳐 `HH:00–HH:50` 단위로 배치한다.

반영을 확인하려면 local bridge가 실행 중인 상태에서 `GET /api/schedule/inbox?date=YYYY-MM-DD`로 `valid`, `tasks`, `excluded`, `errors`, `fingerprint`를 먼저 확인한다. 이후 위젯의 자동 조회(최대 60초) 또는 `POST /api/schedule/rebuild`로 시간표를 다시 읽는다. 파일 기록 성공은 업무 완료나 사용자의 receipt를 의미하지 않는다.

## Data boundary

Daybridge does not edit the original daily note. The compiler creates a sanitized quest-board JSON artifact; the app writes status receipts only. AIHUB's `conversation_bridge/daybridge_handoff.py` folds those receipts into the 17:50 closeout and next morning briefing. See:

- [Architecture](docs/ARCHITECTURE.md)
- [Action-list contract](docs/INTEGRATION_CONTRACT.md)
- [Privacy boundary](docs/PRIVACY.md)
- [Google Calendar connection](docs/GOOGLE_CALENDAR.md)
- [Roadmap](docs/ROADMAP.md)
- [Debugging guide](docs/DEBUGGING.md)
- [Contributing](CONTRIBUTING.md)

## Status

The closeout-first compiler, progress bridge, AIHUB handoff integration, and Tauri widget shell are implemented. The native installer build is blocked on this computer until Rust and the Microsoft C++ Build Tools are installed. Licensing and public release remain separate decisions.

## License

No open-source license has been selected yet. Do not reuse or redistribute the source until a license is added.
