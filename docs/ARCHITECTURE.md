# Architecture

## Product shape

Daybridge is an execution layer over MARU, not a second diary or a second calendar. The current product direction is schedule-first: it turns MARU work candidates into a daily timetable around calendar constraints. The layers are:

1. **Session Markdown inbox** — the `daybridge-schedule-writer` Skill turns the user's decision in any Codex session into a date-scoped, fingerprinted local Markdown handoff. This is the primary scheduling entry point and does not wait for a closeout or briefing.
2. **Optional MARU closeout** — produces a detailed, evidence-linked report when that workflow is useful. It is a source of truth and is never edited by Daybridge, but it is not required for direct session scheduling.
3. **Optional Quest Plan** — a sanitized derived artifact for closeout-driven or batch workflows. Stable `mission_id` and `quest_id` let a multi-day mission continue without resetting progress. The input contract is validated before any candidate reaches the scheduler; confirmation questions remain in `review_queue`.
4. **Optional completion-driven continuation** — when enabled, closeout automation invokes the Quest Extractor only after a ready synthesis exists. No fixed 17:40 cron is required, and this path is independent of direct inbox writes.
5. **Calendar busy reader** — a local, user-authorized, read-only adapter that returns only occupied start/end ranges. It has no calendar write path.
6. **Routine planner** — turns personal, opt-in defaults such as a daily supplement reminder into a maximum of two optional candidates. It runs after the session inbox and any board candidates are read and never displaces user-selected work.
7. **DailySchedule** — combines board candidates, inbox candidates, optional routine candidates, busy windows, user settings, prior receipts, and carryover. A configured work window produces deterministic focus, busy, and buffer blocks; without one it produces an untimed `mode=todo` list.
8. **Local bridge and widget** — serves the schedule, preserves receipts, mirrors sanitized user interactions back to MARU, and shows one current action plus a compact timeline.

## Data flow

```text
Any Codex session: user decides a task belongs on the timetable
        ↓ daybridge-schedule-writer → date-scoped Markdown inbox
        ├─ (primary path) ───────────────────────┐
        │                                        │
Optional MARU closeout → Quest Extractor → daybridge_quest_plan.json / .md
        └────────────── (optional alternate) ────┘
                                                 ↓ local bridge
morning Calendar busy sync (read-only) + local cache fallback
        ↓
Daybridge schedule refresh → Current focus / timetable / unscheduled carryover
        ↓ user receipts: start, complete, defer, skip, rebalance remaining blocks
MARU handoff sink (optional) → later reconciliation when that workflow runs

다른 세션이 `Daybridge/inbox/schedule-YYYY-MM-DD.md`를 원자적으로 갱신하면, 다음 `/api/schedule` 조회가 fingerprint를 비교해 변경된 경우에만 재배치한다. `/api/schedule/inbox`는 파싱·제외·오류 상태를 별도로 보여준다.
```

The optional continuation runner writes `daybridge_continuation.json` with `waiting`, `blocked`, or `ready`. A delayed closeout is therefore picked up when it actually finishes rather than being missed by a clock-based follow-up; direct inbox scheduling does not depend on this runner.

## Execution model

- A **mission** aggregates a multi-day outcome; it is not directly checked off.
- A **quest** is one concrete result. It becomes one or more fixed 50-minute focus blocks; its `focus_units` value is the scheduling source of truth. It is not replaced by a calendar event.
- A **step** is a mechanical unit. It is locked only when the plan explicitly declares `depends_on` or sequential execution.
- A **busy block** is a Calendar time constraint. Its event details never enter the schedule.
- A **focus block** is an executable window for one quest when the schedule is timed; in `mode=todo` it is an untimed actionable list item. Todo items use a date-seeded stable shuffle among dependency-ready work so reloads do not reshuffle the day, while A → B → C dependencies remain intact. The widget's workday clock remains independent of task timing in both modes. A **buffer block** protects transitions and is not a task.
- A **routine candidate** is a personal optional practice block. It is scheduled only after every eligible user-selected quest and is not treated as MARU evidence or a briefing-generated obligation.
- Timed `DailySchedule` returns one of `active_focus`, `in_busy_time`, `up_next`, or `free_time` for the present moment. An untimed list returns `todo_list`.
- Deferring unfinished work keeps its stable ID and makes it eligible for tomorrow's schedule as carryover.

## Ownership and safety

| Data | Owner | Daybridge may edit it? |
|---|---|---:|
| Daily notes, worklogs, closeout synthesis | MARU source system | No |
| Quest Plan | MARU extractor | No (read-only consumer) |
| Google Calendar busy windows | User's Calendar | Read only, time ranges only |
| DailySchedule and focus-block receipts | Daybridge | Yes |
| Local board and user receipts | Daybridge | Yes |
| Canonical project memory | MARU memory system | No |

The bridge treats a click as a user acknowledgement, not independent proof. Every quest retains sanitized `source_refs`, coverage, quality, and exclusion warnings. On Windows, the OAuth token file is encrypted with DPAPI; it is not a Credential Manager entry. Calendar event details never cross into Daybridge files or MARU handoffs.

## Persistence and retry contracts (2026-10-01)

All board, schedule and shared-state mutations use the same store gate and date transaction. A prepared final-values journal is durable before destination writes; a later process recovers a prepared journal before returning state. Unknown lock owners and damaged JSON/journals produce explicit errors and preserve the original files. The compiler uses this boundary too. Atomic replacement has bounded Windows sharing-error retries.

Mutating UI requests carry a stable request ID. Local user state, the request result and a sanitized handoff outbox entry commit in one transaction. A retry of the same operation returns the saved result instead of adding another event or task. Outbox delivery is separate: `local_saved` establishes local success, while pending or failed delivery remains visible and retries after restart. A ready sink is not evidence of delivery.

Carryover reads the latest valid previous schedule across inactive dates. An empty latest schedule stops older work from reappearing; damaged recent sources are reported instead of skipped. Stable IDs, exact remaining work, dependencies, source metadata and carryover counts survive rebuilds. Work completed or discarded today remains terminal.

The UI, settings store and scheduler share `settings-contract.js`. Buffer minutes are integers from 0 through 30. An explicitly empty break list means no breaks; an omitted list uses defaults. Valid settings and the resulting schedule commit together. Invalid legacy files remain visible until the user saves a valid replacement.

## Native distribution and operational boundary

Release startup selects the manifest-verified `bridge-runtime` resource directory, with bundled Windows x64 Node and a bundled bridge entry. It does not search for a checkout or system Node. Debug builds retain the development fallback. The distribution wrapper builds in `src-tauri/target/package`, preserving the historical operational executable.

The early `--validate-package` branch runs before Tauri UI, startup registration or keep-alive initialization. It permits only a fresh immediate temporary-directory child and owned token, isolates data/profile/environment, uses a random port and forbids storage migration and Calendar authorization. A Windows Job Object stops its own bridge when the validation parent exits or is killed. `verify:package` checks save/restart/cleanup behavior; `verify:installer` checks and extracts the NSIS inventory, then runs the same checks on its actual payload. Neither executes NSIS installation or verifies login startup.

Health exposes bridge identity, storage-location selection and configuration mismatch. Read-only diagnostics preserve an active storage location when the pointer changes and report the mismatch. Selecting an operational source of truth, migrating data, restarting the actual app and changing startup registration require separate scoped action. Historical worklogs describe the state at their own dates; current behavior follows the source and current verification receipts.
