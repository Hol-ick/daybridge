# Architecture

## Product shape

Daybridge is an execution layer over AIHUB, not a second diary. The layers are:

1. **AIHUB closeout** — produces the detailed, evidence-linked report. It is the source of truth and is never edited by Daybridge.
2. **Completion-driven continuation** — the closeout automation invokes the Quest Extractor only after a ready synthesis exists. No fixed 17:40 cron is required.
3. **Quest Plan** — a sanitized derived artifact. Stable `mission_id` and `quest_id` let a multi-day mission continue without resetting progress.
4. **Daybridge compiler and bridge** — converts the plan into a local board, preserves receipts, and mirrors sanitized user interactions back to AIHUB.
5. **Widget** — shows atomic quests (one observable outcome, normally 10–30 minutes), explicit sequence locks, progress, and carryover.

## Data flow

```text
17:30 AIHUB detailed closeout (may run long)
        ↓ closeout packet ready signal
        ↓ Quest Extractor + quality gate + board compiler
        ↓ daybridge_quest_plan.json / .md
09:05 Daybridge board refresh → Now / Next / Waiting / Completed
        ↓ user receipts: complete, defer, blocked, resume
AIHUB handoff sink → next closeout reconciliation
```

The continuation runner writes `daybridge_continuation.json` with `waiting`, `blocked`, or `ready`. A delayed closeout is therefore picked up when it actually finishes rather than being missed by a clock-based follow-up.

## Execution model

- A **mission** aggregates a multi-day outcome; it is not directly checked off.
- A **quest** is one concrete result. Large work is split into several quests rather than hidden in one parent card.
- A **step** is a mechanical unit. It is locked only when the plan explicitly declares `depends_on` or sequential execution.
- States are `ready`, `in_progress`, `deferred`, `blocked`, and `completed`.
- There are no XP, levels, badges, or artificial side-quest buckets. Priority (`must`, `should`, `could`) and execution mode (`independent`, `sequential`) are enough.
- Deferring a quest keeps its stable ID and moves the unfinished work into the next plan as carryover.

## Ownership and safety

| Data | Owner | Daybridge may edit it? |
|---|---|---:|
| Daily notes, worklogs, closeout synthesis | AIHUB source system | No |
| Quest Plan | AIHUB extractor | No (read-only consumer) |
| Local board and user receipts | Daybridge | Yes |
| Canonical project memory | AIHUB memory system | No |

The bridge treats a click as a user acknowledgement, not independent proof. Every quest retains sanitized `source_refs`, coverage, quality, and exclusion warnings.
