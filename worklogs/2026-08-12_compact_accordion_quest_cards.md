# Compact Accordion Quest Cards

- Date: 2026-08-12 KST
- Status: implemented; native installer prerequisites remain pending

## Purpose

Make the card interaction unmistakable: collapsed parent quests stay compact, and clicking one grows that same card into a focused detail surface.

## Implemented

- Replaced the flat one-card task list with a compact list of parent quest cards.
- Added a single-open accordion state. The clicked parent card grows into a dark focus surface with its title and progress bar.
- Added the parent quest summary and done-when detail inside the expanded card.
- Rendered each parent checklist item as a smaller full-card sub-quest control inside the open card.
- Kept automatic progress receipts: clicking a sub-quest updates the original parent quest and records `in_progress` or `completed` through the existing bridge path.
- Kept the UI free of manual status, check-in, source, XP, and connection controls.
- Updated the isolated Playwright smoke test to verify compact closed cards, one expanded card, visible detail content, sub-quest completion, and no removed controls.

## Changed files

- `src/main.ts`
- `src/styles.css`
- `scripts/widget-smoke.py`
- `docs/superpowers/plans/2026-08-12-compact-accordion-quests.md`
- `test-artifacts/daybridge-compact-accordion.png` (local verification artifact)

## Verification

- `pnpm check` passed.
- `pnpm build` passed.
- `pnpm test:compiler` passed: 4 tests, 0 failures.
- The isolated Playwright smoke test passed, including collapsed default state, single-card expansion, summary rendering, sub-quest completion, and no status/report/source controls.
- Visual inspection confirmed one large expanded parent card with compact sub-quest cards and collapsed sibling cards.
- `git diff --check` reported no whitespace errors; Git emitted only existing line-ending warnings.

## Decisions and boundaries

- Only presentation changed. The closeout compiler, AIHUB source boundary, and automatic receipt contract remain unchanged.
- A completion click is still a user acknowledgement, not independent verification.
- Native Tauri packaging remains blocked by the existing Rust/MSVC/Windows SDK prerequisite.

## Recommended next action

Use the compact accordion on the next real closeout and tune the expanded detail density from actual daily use.
