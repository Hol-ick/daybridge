# Card-first Quest Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the information-heavy Daybridge board with a card-first quest deck where parent cards unfold and sub-quest cards complete by tapping their whole surface.

**Architecture:** Keep the current local bridge/report contract intact. `src/main.ts` owns only transient presentation state: the expanded parent quest, a visible status deck, and a brief completion celebration. A parent card expands with CSS grid-height animation; its sub-quest cards are buttons that toggle completion and reuse `sendReport` to persist the resulting receipt.

**Tech Stack:** Vite, strict TypeScript, semantic HTML buttons, CSS animations, native Python Playwright smoke check.

## Global constraints

- Do not use native `<select>` controls for quest or sub-quest status.
- A parent quest card opens/closes by clicking its full header surface; a sub-quest card toggles completion by clicking its full surface.
- Keep status updates as Daybridge receipts through the existing local bridge.
- Respect `prefers-reduced-motion` and retain visible keyboard focus.
- Do not alter the closeout compiler or AIHUB source boundary for this visual interaction change.

---

### Task 1: Replace selector-driven interaction state with card state

**Files:**
- Modify: `src/main.ts`
- Modify: `scripts/widget-smoke.py`

**Interfaces:**
- Consumes: `Quest`, `QuestStep`, `sendReport`.
- Produces: `expandedQuestId`, `statusDeckQuestId`, `celebratingQuestId`; actions `toggle-quest`, `toggle-step`, `toggle-status-deck`, `set-status`.

- [ ] Add a failing smoke assertion that clicking `.quest-card-trigger` reveals `.subquest-card` buttons and that clicking one sends the UI into a completed visual state.
- [ ] Run the smoke check and confirm it fails because the card-first selectors do not exist.
- [ ] Remove `statusOptions` and quest `<select>` output. Render a full-width parent card trigger, button sub-quest cards, and a status card deck with explicit `data-action` values.
- [ ] Update click handling so parent clicks only expand/collapse, sub-quest clicks toggle completion, and a status-card click sends the existing sanitized report.
- [ ] Re-run the smoke check and confirm the click interactions pass without page errors.

### Task 2: Build the unfolding Quest Deck visual system

**Files:**
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: the `quest-card`, `quest-card-trigger`, `quest-details`, `subquest-card`, and `status-deck` structure from Task 1.
- Produces: clipped-but-animated details, completion glow, progress movement, staggered card entrance, and reduced-motion fallback.

- [ ] Replace the dense static card layout with a “quest deck” token system: ink `#12251B`, forest `#235E40`, mist `#EEF7F0`, spark `#D8FF83`, and pause `#DCC8FF`.
- [ ] Animate parent cards on entry, use CSS grid rows to unfold details, and stagger sub-quest card entry through a `--stagger` custom property.
- [ ] Give a completed sub-quest a one-shot check sweep and a parent card a brief quest-cleared glow when all steps are complete.
- [ ] Add hover, active, focus, and `prefers-reduced-motion: reduce` behavior; animations must not block interaction.

### Task 3: Visual regression check and durable handoff

**Files:**
- Modify: `scripts/widget-smoke.py`
- Create: `worklogs/2026-08-11_card_first_quest_deck.md`
- Modify: `PROJECT_STATUS.md`

**Interfaces:**
- Consumes: local bridge board and browser preview.
- Produces: screenshot proving one expanded quest and clickable sub-quest card UI; recorded verification and remaining native prerequisites.

- [ ] Start the bridge and Vite server with the test helper, run the smoke check, and capture `test-artifacts/daybridge-card-deck.png`.
- [ ] Inspect the screenshot for readable collapsed/expanded hierarchy, no native dropdowns, and a visible status-card deck.
- [ ] Run `pnpm check`, `pnpm build`, and `pnpm test:compiler`; update the worklog and status document with only verified results.
