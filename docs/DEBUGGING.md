# Debugging Daybridge

Daybridge is easiest to debug one layer at a time: compiler, local bridge, browser UI, then AIHUB handoff.

## 1. Rebuild today's board

From the repository root:

```powershell
pnpm compile -- --target-date 2026-08-11 --source-date 2026-08-10 --print
```

The compiler reads the diary without editing it. Check the quest count, titles, statuses, and `diary://` source references. If the board is unexpectedly empty, confirm that the previous diary exists and that the source section uses a heading or field such as `다음 행동`, `내일 첫 행동`, `남은 작업`, `확인 필요`, or `요청/다음 행동`.

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

## 4. Check the AIHUB handoff

At closeout, run the collector for the work date:

```powershell
python -B .\04_Operations_And_Automation\Memory_System\conversation_bridge\daybridge_handoff.py collect --date 2026-08-11 --write
```

Inspect the generated JSON/Markdown for `status`, `event_count`, `completed`, `open_items`, `next_actions`, and `confirmation_questions`. Then run the normal closeout or morning briefing pipeline. A `not_available` status means no Daybridge event was found; it must remain visible as a data gap.

## Common symptoms

| Symptom | Check |
| --- | --- |
| Demo board remains visible | Start `pnpm bridge`, generate today's board, and reload the browser. |
| Board is empty | Run the compiler with `--print` and inspect the source date and diary headings. |
| Status changes disappear after reload | Check that the bridge is running; browser storage is only a local fallback. |
| `connected: false` | Check `%LOCALAPPDATA%\AIHUB\environment.json` and the `aihub_root` value. |
| Handoff has zero events | Confirm `eventRecorded: true`, the activity date, and that closeout collected the same date. |
| A quest looks too broad | Narrow the diary's next-action sentence; the compiler intentionally preserves source wording and does not invent subtasks. |

## Verification commands

```powershell
pnpm check
pnpm build
node scripts/compile-quests.mjs --self-test
python -B .\04_Operations_And_Automation\Memory_System\conversation_bridge\daybridge_handoff.py --self-test
```
