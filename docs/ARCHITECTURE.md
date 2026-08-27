# Architecture

## Product shape

Daybridge is an execution layer over AIHUB, not a second diary or a second calendar. The current product direction is schedule-first: it turns AIHUB work candidates into a daily timetable around calendar constraints. The layers are:

1. **Session Markdown inbox** — the `daybridge-schedule-writer` Skill turns the user's decision in any Codex session into a date-scoped, fingerprinted local Markdown handoff. This is the primary scheduling entry point and does not wait for a closeout or briefing.
2. **Optional AIHUB closeout** — produces a detailed, evidence-linked report when that workflow is useful. It is a source of truth and is never edited by Daybridge, but it is not required for direct session scheduling.
3. **Optional Quest Plan** — a sanitized derived artifact for closeout-driven or batch workflows. Stable `mission_id` and `quest_id` let a multi-day mission continue without resetting progress. The input contract is validated before any candidate reaches the scheduler; confirmation questions remain in `review_queue`.
4. **Optional completion-driven continuation** — when enabled, closeout automation invokes the Quest Extractor only after a ready synthesis exists. No fixed 17:40 cron is required, and this path is independent of direct inbox writes.
5. **Calendar busy reader** — a local, user-authorized, read-only adapter that returns only occupied start/end ranges. It has no calendar write path.
6. **Routine planner** — turns personal, opt-in defaults such as Linux learning into a maximum of two optional candidates. It runs after the session inbox and any board candidates are read and never displaces user-selected work.
7. **DailySchedule** — combines board candidates, inbox candidates, optional routine candidates, busy windows, user settings, prior receipts, and carryover. A configured work window produces deterministic focus, busy, and buffer blocks; without one it produces an untimed `mode=todo` list.
8. **Local bridge and widget** — serves the schedule, preserves receipts, mirrors sanitized user interactions back to AIHUB, and shows one current action plus a compact timeline.

## Data flow

```text
Any Codex session: user decides a task belongs on the timetable
        ↓ daybridge-schedule-writer → date-scoped Markdown inbox
        ├─ (primary path) ───────────────────────┐
        │                                        │
Optional AIHUB closeout → Quest Extractor → daybridge_quest_plan.json / .md
        └────────────── (optional alternate) ────┘
                                                 ↓ local bridge
morning Calendar busy sync (read-only) + local cache fallback
        ↓
Daybridge schedule refresh → Current focus / timetable / unscheduled carryover
        ↓ user receipts: start, complete, defer, skip, rebalance remaining blocks
AIHUB handoff sink (optional) → later reconciliation when that workflow runs

다른 세션이 `Daybridge/inbox/schedule-YYYY-MM-DD.md`를 원자적으로 갱신하면, 다음 `/api/schedule` 조회가 fingerprint를 비교해 변경된 경우에만 재배치한다. `/api/schedule/inbox`는 파싱·제외·오류 상태를 별도로 보여준다.
```

The optional continuation runner writes `daybridge_continuation.json` with `waiting`, `blocked`, or `ready`. A delayed closeout is therefore picked up when it actually finishes rather than being missed by a clock-based follow-up; direct inbox scheduling does not depend on this runner.

## Execution model

- A **mission** aggregates a multi-day outcome; it is not directly checked off.
- A **quest** is one concrete result. It becomes one or more fixed 50-minute focus blocks; its `focus_units` value is the scheduling source of truth. It is not replaced by a calendar event.
- A **step** is a mechanical unit. It is locked only when the plan explicitly declares `depends_on` or sequential execution.
- A **busy block** is a Calendar time constraint. Its event details never enter the schedule.
- A **focus block** is an executable window for one quest when the schedule is timed; in `mode=todo` it is an untimed actionable list item. Todo items use a date-seeded stable shuffle among dependency-ready work so reloads do not reshuffle the day, while A → B → C dependencies remain intact. A **buffer block** protects transitions and is not a task.
- A **routine candidate** is a personal optional practice block. It is scheduled only after every eligible user-selected quest and is not treated as AIHUB evidence or a briefing-generated obligation.
- Timed `DailySchedule` returns one of `active_focus`, `in_busy_time`, `up_next`, or `free_time` for the present moment. An untimed list returns `todo_list`.
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
