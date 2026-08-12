# Card-first Quest Deck

- Date: 2026-08-11 KST
- Status: implemented; native installer prerequisites remain pending

## Purpose

Make Daybridge feel like a small daily quest deck: reduce always-visible detail, remove dropdown interaction, and let the user act through the surface of each card.

## Implemented

- Replaced the selector-led expanded board with a parent quest card that unfolds when its full header surface is clicked.
- Made every sub-quest a complete clickable card. Tapping it toggles completion, updates parent progress, and retains the existing status-receipt flow.
- Replaced the status dropdown with six explicit status cards: not started, in progress, paused, blocked, needs confirmation, and complete.
- Kept the optional AIHUB check-in inside an expandable card, so reporting remains available without dominating the board.
- Added a distinct forest-and-spark quest-deck visual system: dealt-card entrances, unfolding details, staggered sub-quest drops, completion sweeps, a cleared-quest glow, and hover/active/focus feedback.
- Added `prefers-reduced-motion` behavior and retained keyboard-operable button semantics.
- Updated the browser smoke check to exercise the full-card parent, sub-quest, and status interactions while aborting local-bridge requests; the preview cannot alter a real board during the visual test.

## Changed files

- `src/main.ts`
- `src/styles.css`
- `scripts/widget-smoke.py`
- `test-artifacts/daybridge-card-deck.png` (local verification artifact)

## Verification

- `pnpm check` passed.
- `pnpm build` passed.
- `pnpm test:compiler` passed: 4 tests, 0 failures.
- The isolated Playwright smoke check passed, including parent-card unfolding, sub-quest completion, and a status-card change.
- Visual inspection of `test-artifacts/daybridge-card-deck.png` confirmed the expanded hierarchy, visible state-card deck, and absence of native dropdown controls.
- `git diff --check` reported no whitespace errors; Git reported only line-ending warnings for existing modified files.

## Decisions and boundaries

- A card click is a user progress receipt only; it is not independent evidence of task completion.
- The closeout compiler and AIHUB source boundary were not changed for this visual interaction update.
- Native Tauri packaging was not re-attempted. It remains blocked by the documented Rust/MSVC/Windows SDK prerequisites.

## Recommended next action

Install the native Windows build prerequisites, launch the widget shell, and verify that this card-first interaction remains comfortable in the actual always-on-top window.
