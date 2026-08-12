# Debugging Daybridge

Daybridge is easiest to debug one layer at a time: closeout synthesis, compiler, local bridge, widget UI, then AIHUB handoff.

## 1. Rebuild a board from one closeout

From the repository root:

```powershell
pnpm compile:closeout -- --target-date 2026-08-11 --source-date 2026-08-10 --print
```

The compiler reads the sanitized closeout without editing it. Check the quest count, parent titles, checklist items, statuses, and `aihub://` source references. If the board is empty, inspect the matching `*_briefing_synthesis.json` first: it must be a `closeout` packet for the requested date, not a future/test artifact, and its action-first fields must contain safe next actions.

The scheduled closeout uses the same path through `daybridge_board.py`. It reads the machine-local `daybridge_root` and `daybridge_node` profile fields, creates the local board, and stores a redacted AIHUB receipt. Neither absolute path belongs in shared AIHUB documents.

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

## 3. Check a status report

Use the UI to change a quest status or submit a progress note. The bridge should return `eventRecorded: true`. The event is stored locally and mirrored to the AIHUB automation-owned `reports/daily/_system/daybridge_handoff/YYYY-MM-DD/` folder. The original diary is never edited.

## 4. Check the floating widget

패키징은 디버깅에 필요하지 않다. 기본 개발 루틴은 다음과 같다.

```powershell
# 터미널 1 — 화면과 코드 자동 새로고침
pnpm dev
```

브라우저에서 `http://127.0.0.1:5173`을 열어 UI를 확인한다. 저장할 때마다 화면이 갱신되므로 카드 간격, 확장 애니메이션, 상태 클릭을 즉시 반복해서 확인할 수 있다. AIHUB 연결과 상태 영수증까지 확인할 때만 두 번째 터미널을 추가한다.

```powershell
# 터미널 2 — 선택 사항: 로컬 보드와 상태 기록
pnpm bridge
```

이 경로에서 먼저 카드 확장·서브 퀘스트·순차 잠금·보류를 검증한 뒤, 네이티브 창을 확인한다.

```powershell
# 선택 사항 — Rust/MSVC/WebView2가 설치된 컴퓨터에서만
pnpm dev:widget
```

`pnpm build:widget`은 설치 파일을 만들기 때문에 기능을 바꿀 때마다 실행하지 않는다. 릴리스 후보를 만들 때만 실행한다.

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
| Board is empty | Run the closeout compiler with `--print` and inspect the source date, packet phase, and action-first fields. |
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
