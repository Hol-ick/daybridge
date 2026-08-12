# Single-card Daily Quest Implementation Plan

> **For implementation:** execute in this session with a focused browser regression check after each interaction change.

**Goal:** Reduce Daybridge to one large, collapsed-by-default daily quest card. Opening that card exposes only the actionable sub-quest cards; all status, source, achievement, and explanatory UI is removed.

**Architecture:** Preserve the existing board and report contract. The presentation flattens the board's parent-quest steps into one daily task list, while each click still updates its original parent quest through `sendReport`. The UI owns one transient `dailyCardExpanded` state only.

**Tech Stack:** Vite, strict TypeScript, CSS animations, isolated Python Playwright smoke test.

## Non-negotiable interaction rules

- The widget opens in the collapsed state.
- Exactly one large daily card is visible in the normal state.
- The card front contains only the next actionable item, a compact progress count, and its expand affordance.
- Opening it reveals full-width sub-quest cards and nothing else; no manual status control, check-in form, source card, XP, project label, summary, board instructions, achievement, or footer copy.
- Clicking a sub-quest remains a user progress receipt: its parent quest automatically reports `in_progress` or `completed` through the existing bridge contract.
- Motion is limited to the single-card unfold, the sub-quest cascade, and task completion feedback; reduced motion remains supported.

### Task 1: Replace the board presentation with a single daily card

**Files:**
- Modify: `src/main.ts`
- Modify: `scripts/widget-smoke.py`

- [ ] Render one collapsed `daily-quest-card` from all board steps instead of compact/expanded quest lists.
- [ ] Remove all manual status, report, source, summary, achievement, project, XP, and connection-copy render paths.
- [ ] Expand the daily card with its full surface; render each flattened step as a complete `daily-task-card` button.
- [ ] Retain parent-quest mapping so a task click reports the updated parent steps and automatic status to the local bridge.
- [ ] Update the smoke check to prove: collapsed by default, card opens, one task completes, no status/source/report controls appear, and no page error occurs.

### Task 2: Rebuild the visual system around the folded daily card

**Files:**
- Modify: `src/styles.css`

- [ ] Remove the compact list, multi-card deck, achievement block, footer, status deck, report card, and source-card styles.
- [ ] Build a spacious single-card composition with a quiet collapsed face, a controlled unfold, a staggered task reveal, and a completion response.
- [ ] Preserve full-card keyboard focus and `prefers-reduced-motion` behavior.

### Task 3: Verify and record the simplified interaction

**Files:**
- Modify: `PROJECT_STATUS.md`
- Create: `worklogs/2026-08-11_single_card_daily_quest.md`

- [ ] Run strict TypeScript, production build, compiler tests, whitespace check, and the isolated browser smoke test.
- [ ] Inspect the screenshot for one collapsed large card, the expanded task-only view, and no supporting controls.
- [ ] Record only verified results, the retained receipt boundary, and the unchanged native packaging prerequisite.
