# Debugging Daybridge

Daybridge is easiest to debug one layer at a time: direct Skill/inbox or optional closeout synthesis, compiler, local bridge, widget UI, then MARU handoff.

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

The compiler reads the sanitized closeout without editing it. Check the quest count, parent titles, checklist items, statuses, and `maru://` source references. If the board is empty, inspect the matching `*_briefing_synthesis.json` first: it must be a `closeout` packet for the requested date, not a future/test artifact, and its action-first fields must contain safe next actions.

The scheduled closeout uses the same path through `daybridge_board.py`. It reads the machine-local `daybridge_root` and `daybridge_node` profile fields, creates the local board, and stores a redacted MARU receipt. Neither absolute path belongs in shared MARU documents.

### 입력 계약을 먼저 확인하기

새로운 MARU 전달물은 `daybridge_quest_plan` 1.1을 사용한다. `source_date`와 `schedule_date`가 맞는지, 각 후보에 `focus_units`가 있는지, `start_at`/`end_at`이 섞이지 않았는지 먼저 확인한다. 검증 결과에서 `accepted`만 스케줄러로 넘어가며, `review_queue`·`excluded`·`warnings`는 보드 메타데이터에 남는다.

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

`connected: true`는 전달 위치가 구성됐다는 호환 필드다. 실제 전달 성공은 `handoffState.deliveryVerified`와 `state`를 확인한다. 설정된 위치가 있다는 사실만으로 MARU에 자료가 도착했다고 판단하지 않는다.

### 실행 위치와 브리지 식별 진단

일정 조회·재배치 전에 읽기 전용 진단을 실행한다.

```powershell
pnpm diagnose:runtime
```

현재 로컬 프로필도 함께 비교하려면 다음을 사용한다.

```powershell
$runtimeProfilePath = if ($env:MARU_ENV_PROFILE) { $env:MARU_ENV_PROFILE } else { Join-Path $env:LOCALAPPDATA 'MARU/environment.json' }
node scripts/inspect-runtime.mjs --profile $runtimeProfilePath
```

이 명령은 루프백 TCP 연결 후 제한 시간 안에 `/api/health`의 HTTP 응답을 검증한다. 외부 URL·리디렉션은 허용하지 않고 응답 크기를 제한한다. 공유할 수 있는 출력에는 절대 경로·프로필 원문·일정·인증값을 넣지 않는다. 진단은 파일을 복구하거나 저장 위치를 바꾸지 않으며 전달 재시도를 실행하지 않는다.

| 상태 | 의미와 확인할 사항 |
|---|---|
| `unavailable` | 루프백 연결을 확인하지 못했다. 실행 상태와 포트를 확인한다. |
| `foreign_listener` | 포트가 열렸지만 호환되는 Daybridge HTTP 식별을 확인하지 못했다. 그 포트의 프로그램을 자동 종료하지 않는다. |
| `legacy_bridge` | 이전 health 응답 모양이다. 서비스 정체·실행 버전은 아직 검증되지 않았다. |
| `incompatible_bridge` | Daybridge 식별을 주장하지만 현재 schema/필수 필드와 맞지 않는다. |
| `configuration_mismatch` | 실행 데이터와 현재 pointer 또는 실행 코드와 프로필의 `daybridge_root`가 다르다. |
| `configuration_attention` | pointer/config/명시한 프로필을 읽거나 검증하지 못했다. 원본을 보존한 상태에서 오류를 확인한다. |
| `profile_unconfirmed` | MARU 프로필이나 루트 표식을 확인하지 못했고 별도 전달 위치도 없다. |
| `sink_unconfigured` | 전달 위치가 비활성 상태다. 로컬 저장과 외부 전달을 구분한다. |
| `ready` | 전달 위치는 구성돼 있지만 이 실행에서 성공한 전달 증거는 없다. |
| `pending` / `delivery_failed` | 로컬 저장 뒤 전달 대기 또는 실제 전달 시도 실패가 있다. |
| `connected` | 현재 데이터·전달 위치에서 성공한 전달을 이 실행이 관측했고 실패·대기가 없다. |

새 health는 `service`, `schemaVersion`, `bridgeVersion`, `instanceId`, `startedAt`, `dataLocationSource`, `configurationMismatch`, `profile`, `handoffState`를 기존 필드에 추가한다. `bridgeVersion`은 package 버전과 브리지 진입 파일의 해시이며 전체 저장소 commit 검증을 대신하지 않는다. `instanceId`는 프로세스가 다시 시작하면 바뀐다. 식별 응답은 서비스를 구분하기 위한 계약이며 사용자 인증은 아니다.

저장 위치 선택은 pointer → `DAYBRIDGE_DATA_DIR` → 기본 AppData 순서다. 실행 도중 pointer만 바뀌면 실행 중 데이터는 그대로 유지하고 mismatch를 표시한다. 프로필의 `daybridge_root`는 코드 실행 위치이며 데이터 저장 위치와 비교하지 않는다. `MARU_ENV_PROFILE`을 지정하면 그 파일을 먼저 사용하고, 없으면 로컬 AppData의 MARU 프로필을 읽는다. 자동 발견 전달 위치는 프로필 루트 표식이 확인될 때만 사용하며 config의 명시적인 null/빈 값은 발견 경로를 비활성화한다.

현재 네이티브 코드는 단순 TCP 연결 대신 최대 500ms·16KiB 안의 HTTP 식별을 확인한다. 확인되지 않은 listener는 복구 기동에서 오류로 표시하고 자동 교체하지 않는다. 진단·소스 수정과 실제 운영 앱 교체·재시작은 별도 단계다. 운영 자료를 옮기거나 실제 앱을 다시 시작하기 전 정본 위치·백업·복구 조건을 확인한다.

### 실행이 사라졌을 때 런타임 이벤트 확인

패키지 위젯과 local bridge는 서로 다른 프로세스이므로 로그도 분리한다. 다음 두 파일은 민감한 원문 대신 이벤트명·날짜·상태·오류·블록 수 같은 진단 정보만 NDJSON으로 기록한다. 패키지 위젯은 시작할 때 `127.0.0.1:39393`의 HTTP 서비스 식별을 확인한다. 브리지가 없으면 해시를 검증한 `bridge-runtime`의 Node와 스크립트를 콘솔 없이 실행한다. 체크아웃 fallback은 debug 빌드에서만 허용한다. `bridge_autostart_spawned` 뒤 `bridge_autostart_ready`가 남으면 브리지 기동까지 확인된 상태다. 시작 오류가 있으면 번들 리소스·manifest와 listener 식별 결과를 확인한다.

```powershell
# 네이티브 위젯: 시작·명시적 종료·창 종료·WebView 오류
Get-Content "$env:APPDATA\com.daybridge.widget\logs\runtime-events.ndjson" -Tail 100

# local bridge: inbox/보드/시간표 조회와 API 오류
Get-Content "$env:LOCALAPPDATA\Daybridge\logs\bridge-events.ndjson" -Tail 100
```

`app_exit_requested`, `tray_quit_requested`, `window_close_requested_exit`, `schedule_load_error`, `board_refresh_error`, `window_destroyed`, `window_error`를 시간순으로 대조한다. 현재 앱에는 18:00 자동 종료가 없다. `workday_auto_exit_triggered`는 이전 버전의 기록일 수 있으므로 발생 시각과 실제 실행 파일을 확인한다. WebView/창 오류만 있으면 충돌·렌더링 경로를 조사한다. 로그 파일이 없다는 사실만으로 미실행을 단정하지 말고 실행 프로세스와 실제 AppData 경로도 확인한다.

패키지 위젯은 실행될 때 별도의 프로세스 감시자를 자동으로 시작한다. 위젯 프로세스가 예기치 않게 사라지면 감시자가 3초 주기로 확인해 다시 실행한다. `process_watchdog_started`, `process_relaunch_requested`, `process_relaunch_error`를 같은 네이티브 로그에서 확인한다. 트레이의 **종료**는 `explicit-exit.flag`를 남겨 감시자를 정상 중지하므로, 해당 종료는 자동 재실행되지 않는다. 다음 번 Daybridge 실행 또는 Windows 로그인 시에는 이 표식이 자동으로 해제된다.

시간 설정을 비워 둔 경우에는 정상적으로 `schedule.mode=todo`, `timeConfigured=false`가 반환된다. 이 모드에서는 `startAt`·`endAt`가 없는 오늘 할 일 목록만 만들고, 시간 슬롯 이동·점심시간 배치는 사용하지 않는다. 근무일 카운트다운은 작업 카드 시각과 독립적으로 동작하며 앱을 자동 종료하지 않는다. `schedule_read`에 `mode=todo`가 찍히면 오류가 아니라 의도된 가벼운 목록 모드다.

## 3. Check a status report

Use the UI to change a quest status or submit a progress note. `eventRecorded: true` confirms the local event record. Check `local_saved`, the outbox pending state and delivery evidence separately: a saved event does not prove delivery to the MARU automation-owned `reports/daily/_system/daybridge_handoff/YYYY-MM-DD/` folder. The original diary is never edited.

## 4. Check the floating widget

패키징은 디버깅에 필요하지 않다. 평소에는 아래 **한 명령**으로 UI와 bridge를 함께 실행한다.

```powershell
pnpm dev:all
```

- 화면 확인: `http://127.0.0.1:5173`
- 브라우저 개발자 도구: React 화면·네트워크·콘솔 오류 확인
- bridge 로그: 같은 터미널에서 API·MARU handoff·Calendar relay 오류 확인
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

브라우저에서 `http://127.0.0.1:5173`을 열어 UI를 확인한다. 저장할 때마다 화면이 갱신되므로 카드 간격, 확장 애니메이션, 상태 클릭을 즉시 반복해서 확인할 수 있다. MARU 연결과 상태 영수증까지 확인할 때만 두 번째 터미널을 추가한다.

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

In the native shell, use `pnpm dev:widget`. The tray provides **위젯 다시 표시** and explicit Quit. A window close request is intercepted and routed through explicit app shutdown so keep-alive does not reopen it. Visibility recovery remains active while the app runs. The current source has no 18:00 automatic app or computer shutdown.

위젯이 보이지 않을 때는 대시보드 또는 오버레이의 **설정**을 열어 **위젯 새로고침**을 누른다. 이 동작은 저장·재배치와 분리되어 위젯 표시를 복구하고 일정·캘린더 상태를 다시 읽는다. 성공하면 `위젯을 새로고침했어요` 알림과 `overlay_manual_refresh` 이벤트가 남고, 조회 실패는 `overlay_manual_refresh_error`로 기록된다.

For an installer build, check the native prerequisites first:

```powershell
pnpm tauri info
pnpm build:widget
```

Windows needs WebView2, Rust with the MSVC target, and Microsoft C++ Build Tools with the Windows SDK. A missing compiler/toolchain is a local setup blocker, not a successful native build.

`pnpm build:widget` prepares the pinned Windows x64 bridge runtime and then
merges `src-tauri/tauri.release.conf.json` into the Tauri build. The resulting
resources contain their own Node executable and bridge dependencies. Release
startup verifies their file hashes and selects the resource directory; it never
walks up to a development checkout or uses `DAYBRIDGE_NODE`/system Node.
Development builds retain the checkout fallback when bundled resources are absent.
The distribution command builds under `src-tauri/target/package`, separate from
the historical `target/release` executable that may still be running.

The application tracks `src-tauri/Cargo.lock`; native regression uses `--locked`,
and the distribution wrapper passes `--locked` to Cargo. Tauri, tauri-build and
the direct windows crate are pinned to the tested compatible versions. Update
these together and check fresh CI results; a cached local build does not prove
that a clean runner resolves the same dependency graph.

Use `pnpm build:widget --no-bundle` to compile the release executable and resource
layout without creating an installer. Compilation does not verify an installed
application. Standalone `tauri build` without the release configuration does not
include the bridge runtime and is not the supported distribution command.

`pnpm package:bridge <new-output-directory>` prepares only the runtime.
`pnpm package:bridge --tauri` prepares its generated resource folder. Rebuilding
replaces a previous complete artifact only after verifying its inventory and
checksums; unknown files, linked paths and damaged artifacts are preserved with
an error. Generated runtime files stay outside Git. Actual installation, login
startup, keep-alive and operational data selection require separate evidence.

### Validate the executable and installer payload

```powershell
pnpm verify:package
pnpm verify:installer
```

The first command accepts only a build containing the explicit validation marker; an older operational executable is refused before launch. It copies the executable and hash-verified resources to a new temporary directory and runs the early native validation branch with empty PATH, isolated data/profile and a random port. It checks runtime identity, local save, restart persistence, storage/OAuth restrictions, graceful cleanup and child cleanup after killing its own parent. Windows startup registration is compared without exposing its value.

The second command uses existing 7-Zip to validate the NSIS inventory and extract to a new temporary directory, then executes the extracted payload with the same checks. Receipts are `test-artifacts/package-execution.json` and `test-artifacts/installer-payload.json`. The installer receipt deliberately keeps `installationExecuted`, `loginVerified` and `installerVerified` false. Tauri stamps the embedded bundle-type marker as NSS for the installer payload and restores UNK in the build executable; record the two executable hashes separately.

For actual installation verification, use an isolated Windows test environment and separately record NSIS install success, installed resources, launch without checkout/system Node, temporary-data save/restart, logout/login startup, uninstall and residual files. No such environment was established in the 2026-10-01 payload check. Do not treat extraction as installation or replace the operational app to obtain this evidence.

## 5. Check the MARU handoff

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
| `connected: false` | Check `%LOCALAPPDATA%\MARU\environment.json` and the `maru_root` value. |
| Handoff has zero events | Confirm `eventRecorded: true`, the activity date, and that closeout collected the same date. |
| A quest looks too broad | Check the closeout's workstream/evidence metadata. The compiler groups it into a parent quest but must not invent ungrounded subtasks. |

## Verification commands

```powershell
pnpm check
pnpm test
pnpm build
cargo test --offline --manifest-path src-tauri/Cargo.toml
node scripts/compile-quests.mjs --self-test
python -B .\04_Operations_And_Automation\Memory_System\conversation_bridge\daybridge_handoff.py --self-test
```

`pnpm test`는 중첩된 Calendar·일정 모듈을 포함해 전체 `.test.mjs`를 순차 실행한다. 모든 브리지 API 검사는 임시 데이터와 독립 포트에서 실행된다. 검사 실패를 건너뛰지 않으며, 반환된 실패 종료값을 CI도 사용한다. 타입 범위 검사는 실행 JS·JSX 파일이 `tsconfig`에서 빠지거나 `@ts-nocheck`로 숨겨지면 실패한다.

화면 검사는 `pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort`로 개발 화면을 연 뒤 `python scripts/widget-smoke.py`를 실행한다. Python Playwright와 Chromium이 준비되어 있어야 한다. 스크립트는 실제 39393 브리지로 향하는 요청을 차단하고 시나리오별 mock 응답만 사용한다. 미등록 요청·화면 오류가 있으면 실패하며 캡처는 Git에서 제외된 `test-artifacts`에 남는다. 운영 브리지를 띄울 필요는 없다.

760×720 캔버스에서 접힌 카드 영역은 `(472,656,288,64)`이고, 펼쳐진 카드의 아래쪽은 항상 720에 맞는다. 설정 창의 화면 검증 크기는 720×680이다. 이 검사는 브라우저 DOM과 클릭 동작을 확인하며 실제 Windows 앱의 포커스·작업표시줄 동작 검증과 구분한다.
