# Quest Plan architecture and carryover

- Date: 2026-08-12 KST
- Status: implemented; native installer prerequisites remain pending

## Purpose

Separate detailed AIHUB closeout reporting from the Daybridge execution board. Preserve every eligible atomic user task, explicit ordering, and multi-day progress without XP or artificial side-quest categories.

## Implemented

- Added the AIHUB `daybridge_quest_extractor.py` to derive a sanitized Quest Plan with stable mission/quest/step IDs, actor/kind filtering, explicit dependencies, source references, and an auditable excluded list.
- Updated `daybridge_board.py` so the Quest Extractor runs before the Daybridge compiler; raw closeout fallback is visibly marked attention.
- Rebuilt `scripts/compile-quests.mjs` around Quest Plan input while retaining a compatibility path for old closeout packets. Existing receipts are merged by stable ID and unfinished work increments carryover.
- Added `ready`, `in_progress`, `deferred`, `blocked`, and `completed` state handling to the local bridge and React state model.
- Reworked the widget into Now / Next / Waiting / Completed sections. Cards remain compact until clicked, then expand downward; sequential steps lock only when dependencies are declared; `내일 계속` records a defer receipt.
- Updated the integration contract, architecture, project status, and implementation plan.

## Verification

- Quest compiler tests: 4 passed.
- Compiler self-test: passed.
- AIHUB Quest Extractor self-test: passed.
- AIHUB board runner self-test: passed.
- TypeScript check and production Vite build: passed.

## Boundaries

- AIHUB source diaries, worklogs, and closeout reports remain read-only.
- A Daybridge click is a user receipt, not independent verification.
- Native Tauri packaging remains blocked by the existing Rust/MSVC/Windows SDK prerequisite.
