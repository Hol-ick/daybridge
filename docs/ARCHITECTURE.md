# Architecture

## Product shape

Daybridge is an execution layer over AIHUB, not a second diary or a second calendar. The current product direction is schedule-first: it turns AIHUB work candidates into a daily timetable around calendar constraints. The layers are:

1. **AIHUB closeout** — produces the detailed, evidence-linked report. It is the source of truth and is never edited by Daybridge.
2. **Completion-driven continuation** — the closeout automation invokes the Quest Extractor only after a ready synthesis exists. No fixed 17:40 cron is required.
3. **Quest Plan** — a sanitized derived artifact. Stable `mission_id` and `quest_id` let a multi-day mission continue without resetting progress. The input contract is validated before any candidate reaches the scheduler; confirmation questions remain in `review_queue`.
4. **Calendar busy reader** — a local, user-authorized, read-only adapter that returns only occupied start/end ranges. It has no calendar write path.
5. **Routine planner** — turns personal, opt-in defaults such as Linux learning into a maximum of two optional candidates. It runs after the briefing board is read and never displaces briefing work.
6. **DailySchedule** — combines briefing candidates, optional routine candidates, busy windows, user settings, prior receipts, and carryover into deterministic focus, busy, and buffer blocks.
7. **Local bridge and widget** — serves the schedule, preserves receipts, mirrors sanitized user interactions back to AIHUB, and shows one current action plus a compact timeline.

## Data flow

```text
17:30 AIHUB detailed closeout (may run long)
        ↓ closeout packet ready signal
        ↓ Quest Extractor + quality gate + board compiler
        ↓ daybridge_quest_plan.json / .md
morning Calendar busy sync (read-only) + local cache fallback
        ↓
Daybridge schedule refresh → Current focus / timetable / unscheduled carryover
        ↓ user receipts: start, complete, defer, skip, rebalance remaining blocks
AIHUB handoff sink → next closeout reconciliation
```

The continuation runner writes `daybridge_continuation.json` with `waiting`, `blocked`, or `ready`. A delayed closeout is therefore picked up when it actually finishes rather than being missed by a clock-based follow-up.

## Execution model

- A **mission** aggregates a multi-day outcome; it is not directly checked off.
- A **quest** is one concrete result. It becomes one or more fixed 50-minute focus blocks; its `focus_units` value is the scheduling source of truth. It is not replaced by a calendar event.
- A **step** is a mechanical unit. It is locked only when the plan explicitly declares `depends_on` or sequential execution.
- A **busy block** is a Calendar time constraint. Its event details never enter the schedule.
- A **focus block** is an executable window for one quest. A **buffer block** protects transitions and is not a task.
- A **routine candidate** is a personal optional practice block. It is scheduled only after every eligible briefing quest and is not treated as AIHUB evidence or a briefing-generated obligation.
- `DailySchedule` returns one of `active_focus`, `in_busy_time`, `up_next`, or `free_time` for the present moment.
- Deferring unfinished work keeps its stable ID and makes it eligible for tomorrow's schedule as carryover.

## Ownership and safety

| Data | Owner | Daybridge may edit it? |
|---|---|---:|
| Daily notes, worklogs, closeout synthesis | AIHUB source system | No |
| Quest Plan | AIHUB extractor | No (read-only consumer) |
| Google Calendar busy windows | User's Calendar | Read only, time ranges only |
| DailySchedule and focus-block receipts | Daybridge | Yes |
| Local board and user receipts | Daybridge | Yes |
| Canonical project memory | AIHUB memory system | No |

The bridge treats a click as a user acknowledgement, not independent proof. Every quest retains sanitized `source_refs`, coverage, quality, and exclusion warnings. Calendar OAuth credentials live only in the operating system credential store; calendar event fields never cross into Daybridge files or AIHUB handoffs.
