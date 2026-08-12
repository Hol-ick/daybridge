# Single-card Daily Quest

- Date: 2026-08-11 KST
- Status: implemented; native installer prerequisites remain pending

## Purpose

Remove the remaining supporting UI from Daybridge and make the entire day manageable from one large card that is collapsed by default.

## Implemented

- Replaced compact/expanded quest lists with one daily card that shows only the next incomplete action and a compact completion count while closed.
- Opening the card reveals only full-width task cards, flattened from every parent quest checklist. Each task retains its original parent mapping for reporting.
- Removed all visible status switching, check-in, source, achievement, project, XP, summary, board-introduction, connection, and footer-copy UI.
- Kept receipt behavior invisible but intact: checking a task sends its original parent quest an automatic `in_progress` or `completed` Daybridge receipt through the local bridge.
- Rebuilt the motion around one controlled unfold, staggered task entry, and task-completion feedback, with keyboard focus and reduced-motion support.
- Updated the isolated browser smoke test to require one collapsed daily card, expansion, task completion, and the absence of the removed controls.

## Changed files

- `src/main.ts`
- `src/styles.css`
- `scripts/widget-smoke.py`
- `test-artifacts/daybridge-single-card.png` (local verification artifact)

## Verification

- `pnpm check` passed.
- `pnpm build` passed.
- `pnpm test:compiler` passed: 4 tests, 0 failures.
- The isolated Playwright smoke test passed; it asserts the collapsed default, card expansion, one completed task, and no status/report/source controls.
- Visual inspection confirmed the expanded card contains task cards only and the task list remains internally scrollable for longer days.
- `git diff --check` reported no whitespace errors; Git emitted only existing line-ending warnings.

## Decisions and boundaries

- Status is no longer a user-facing interaction; it is derived only to retain the existing progress-receipt contract.
- The compiler, closeout source boundary, and native shell were not changed.
- Task clicks remain user-reported receipts, not independently verified completion.

## Recommended next action

Use the simplified card against the next real closeout, then validate it in the native always-on-top window once the Windows build prerequisites are installed.
