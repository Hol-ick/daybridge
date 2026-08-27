# Debugging Daybridge

Daybridge is easiest to debug one layer at a time: direct Skill/inbox or optional closeout synthesis, compiler, local bridge, widget UI, then AIHUB handoff.

## 0. Directly add one task from any Codex session

closeout·브리핑을 기다릴 필요 없이, 사용자가 등록을 결정한 업무를 `daybridge-schedule-writer` Skill로 정규화한다. Skill이 만든 JSON을 날짜와 함께 기록한 뒤 local bridge에서 inbox를 확인한다.

```powershell
python -B "$env:USERPROFILE\.codex\skills\daybridge-schedule-writer\scripts\write_schedule_inbox.py" upsert --date 2026-08-27 --json-file .\daybridge-quests.json
Invoke-RestMethod "http://127.0.0.1:39393/api/schedule/inbox?date=2026-08-27"
```

응답의 `valid`, `tasks`, `excluded`, `errors`, `fingerprint`를 확인한다. 파일 기록이 성공했지만 `tasks`가 0이면 제목·상태·단위·source ref 경계를 먼저 고친다. `valid=true`이고 일정이 갱신되지 않으면 `/api/schedule`를 다시 조회하거나 `POST /api/schedule/rebuild`를 호출한다.

## 1. (선택) Rebuild a board from one closeout

From the repository root:

```powershell
pnpm compile:closeout -- --target-date 2026-08-11 --source-date 2026-08-10 --print
```

The compiler reads the sanitized closeout without editing it. Check the quest count, parent titles, checklist items, statuses, and `aihub://` source references. If the board is empty, inspect the matching `*_briefing_synthesis.json` first: it must be a `closeout` packet for the requested date, not a future/test artifact, and its action-first fields must contain safe next actions.

The scheduled closeout uses the same path through `daybridge_board.py`. It reads the machine-local `daybridge_root` and `daybridge_node` profile fields, creates the local board, and stores a redacted AIHUB receipt. Neither absolute path belongs in shared AIHUB documents.

### 입력 계약을 먼저 확인하기

새로운 AIHUB 전달물은 `daybridge_quest_plan` 1.1을 사용한다. `source_date`와 `schedule_date`가 맞는지, 각 후보에 `focus_units`가 있는지, `start_at`/`end_at`이 섞이지 않았는지 먼저 확인한다. 검증 결과에서 `accepted`만 스케줄러로 넘어가며, `review_queue`·`excluded`·`warnings`는 보드 메타데이터에 남는다.

```powershell
node --test src/schedule/input-contract.test.mjs scripts/compile-quests.test.mjs
```

`confirmation_questions`가 카드로 나타나면 오래된 컴파일러나 레거시 board를 보고 있는 것이다. 새 board에는 `reviewQueue`로만 남아야 한다. `focus_units: 2`가 `estimateMinutes: 100`, `remaining_units: 1`이 `remainingMinutes: 50`으로 변환되는지도 함께 확인한다.

## 2. Check the local bridge

Start the bridge in a second terminal:

```powershell
pnpm bridge
```

Then inspect:

```powershell
Invoke-RestMethod http://127.0.0.1:39393/api/health
Invoke-RestMethod "http://127.0.0.1:39393/api/board?date=2026-08-11"
```

`connected: true` means the machine-local AIHUB profile resolved a handoff sink. A local-only response is still usable, but it will not reach AIHUB until the bridge is restarted with a valid profile or explicit `DAYBRIDGE_DATA_DIR`/config.

### 실행이 사라졌을 때 런타임 이벤트 확인

패키지 위젯과 local bridge는 서로 다른 프로세스이므로 로그도 분리한다. 다음 두 파일은 민감한 원문 대신 이벤트명·날짜·상태·오류·블록 수 같은 진단 정보만 NDJSON으로 기록한다.

```powershell
# 네이티브 위젯: 시작·자동 종료·창 종료·WebView 오류
Get-Content "$env:APPDATA\com.daybridge.widget\logs\runtime-events.ndjson" -Tail 100

# local bridge: inbox/보드/시간표 조회와 API 오류
Get-Content "$env:LOCALAPPDATA\Daybridge\logs\bridge-events.ndjson" -Tail 100
```

원인 판별 순서는 `workday_auto_exit_triggered` → `app_exit_requested`가 있는지 먼저 보고, 그 뒤 `tray_quit_requested`, `schedule_load_error`, `board_refresh_error`, `window_destroyed`, `window_error`를 시간순으로 대조한다. 전자의 두 이벤트가 같이 있으면 18:00 이후 자동 종료 경로이고, `tray_quit_requested`가 있으면 사용자가 트레이에서 종료한 경로다. WebView/창 오류만 있으면 충돌·렌더링 경로다. 로그 파일이 없으면 새 패키지 위젯 또는 새 bridge가 아직 실행되지 않은 상태다.

시간 설정을 비워 둔 경우에는 정상적으로 `schedule.mode=todo`, `timeConfigured=false`가 반환된다. 이 모드에서는 `startAt`·`endAt`가 없는 오늘 할 일 목록만 만들고, 시간 슬롯 이동·점심시간 차단·18:00 자동 종료를 사용하지 않는다. `schedule_read`에 `mode=todo`가 찍히면 오류가 아니라 의도된 가벼운 목록 모드다.

## 3. Check a status report

Use the UI to change a quest status or submit a progress note. The bridge should return `eventRecorded: true`. The event is stored locally and mirrored to the AIHUB automation-owned `reports/daily/_system/daybridge_handoff/YYYY-MM-DD/` folder. The original diary is never edited.

## 4. Check the floating widget

패키징은 디버깅에 필요하지 않다. 평소에는 아래 **한 명령**으로 UI와 bridge를 함께 실행한다.

```powershell
pnpm dev:all
```

- 화면 확인: `http://127.0.0.1:5173`
- 브라우저 개발자 도구: React 화면·네트워크·콘솔 오류 확인
- bridge 로그: 같은 터미널에서 API·AIHUB handoff·Calendar relay 오류 확인
- 종료: 해당 터미널에서 `Ctrl+C`

### VS Code에서 바로 시작하기

저장소를 VS Code로 열면 `.vscode/tasks.json`과 `.vscode/launch.json`이 함께 제공된다.

1. `Ctrl+Shift+P` → **Tasks: Run Task** → **Daybridge: 개발 환경**을 선택한다.
2. 좌측 **실행 및 디버그**에서 **Daybridge: UI 디버그**를 실행하면 브라우저 UI의 breakpoint·콘솔·네트워크를 볼 수 있다.
3. bridge 코드에서 중단점을 쓰려면 별도 터미널 작업 **Daybridge: bridge 디버거**를 시작한 뒤 **Daybridge: bridge 연결**을 실행한다.

개발 환경과 bridge 디버거는 같은 bridge 포트를 사용하므로 동시에 실행하지 않는다. 평소에는 **개발 환경**, bridge 코드의 중단점이 필요할 때만 **bridge 디버거**를 선택한다.

UI만 빠르게 만질 때는 다음처럼 실행해도 된다.

```powershell
# 터미널 1 — 화면과 코드 자동 새로고침
pnpm dev
```

브라우저에서 `http://127.0.0.1:5173`을 열어 UI를 확인한다. 저장할 때마다 화면이 갱신되므로 카드 간격, 확장 애니메이션, 상태 클릭을 즉시 반복해서 확인할 수 있다. AIHUB 연결과 상태 영수증까지 확인할 때만 두 번째 터미널을 추가한다.

```powershell
# 터미널 2 — 브리핑 보드·Calendar·상태 기록까지 확인할 때
pnpm bridge
```

이 경로에서 먼저 카드 확장·서브 퀘스트·순차 잠금·보류를 검증한 뒤, 네이티브 창을 확인한다.

```powershell
# 선택 사항 — Rust/MSVC/WebView2가 설치된 컴퓨터에서만
pnpm dev:widget
```

`dev:widget`은 UI 개발 서버를 자체적으로 시작한다. 네이티브 위젯에서도 실제 board·status bridge가 필요하면 별도 터미널에 `pnpm bridge`만 실행한다. 이때 `pnpm dev:all`을 함께 실행하면 UI 포트가 겹치므로 사용하지 않는다.

`pnpm build:widget`은 설치 파일을 만들기 때문에 기능을 바꿀 때마다 실행하지 않는다. 릴리스 후보를 만들 때만 실행한다.

bridge 코드 자체를 단계별로 확인해야 하면 다음 명령으로 Node inspector를 연다. Chrome/Edge의 `edge://inspect` 또는 VS Code의 Node attach에서 포트 `9229`에 붙인다.

```powershell
pnpm bridge:inspect
```

이전의 두 터미널 예시는 다음과 같다.

```powershell
pnpm bridge
pnpm dev
```

The compact card should show at most three current focus quests. Select **전체 보기** to inspect all parent quests, change a status, and open **진행 보고**. In the native shell, use `pnpm dev:widget`; its close control hides the widget to the tray, while the tray menu has the explicit Quit command.

For an installer build, check the native prerequisites first:

```powershell
pnpm tauri info
pnpm build:widget
```

Windows needs WebView2, Rust with the MSVC target, and Microsoft C++ Build Tools with the Windows SDK. A missing compiler/toolchain is a local setup blocker, not a successful native build.

## 5. Check the AIHUB handoff

At closeout, run the collector for the work date:

```powershell
python -B .\04_Operations_And_Automation\Memory_System\conversation_bridge\daybridge_handoff.py collect --date 2026-08-11 --write
```

Inspect the generated JSON/Markdown for `status`, `event_count`, `completed`, `open_items`, `next_actions`, and `confirmation_questions`. Then run the normal closeout or morning briefing pipeline. A `not_available` status means no Daybridge event was found; it must remain visible as a data gap.

## Common symptoms

| Symptom | Check |
| --- | --- |
| Demo board remains visible | Start `pnpm bridge`, compile today's board, and reload the browser. |
| Board is empty | First inspect `/api/schedule/inbox` and its `valid`, `tasks`, and `errors`; only if using the optional closeout path, run the closeout compiler with `--print`. |
| Status changes disappear after reload | Check that the bridge is running; browser storage is only a local fallback. |
| `connected: false` | Check `%LOCALAPPDATA%\AIHUB\environment.json` and the `aihub_root` value. |
| Handoff has zero events | Confirm `eventRecorded: true`, the activity date, and that closeout collected the same date. |
| A quest looks too broad | Check the closeout's workstream/evidence metadata. The compiler groups it into a parent quest but must not invent ungrounded subtasks. |

## Verification commands

```powershell
pnpm check
pnpm build
pnpm test:compiler
node scripts/compile-quests.mjs --self-test
python -B .\04_Operations_And_Automation\Memory_System\conversation_bridge\daybridge_handoff.py --self-test
```
