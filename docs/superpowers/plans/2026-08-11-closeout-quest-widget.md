# Closeout Quest Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the next working day's Daybridge board from the sanitized AIHUB closeout packet and present it as a compact Windows always-on-top quest widget.

**Architecture:** The Daybridge compiler reads `*_briefing_synthesis.json` as the primary source, combines it with the matching unified packet for project metadata, and writes a local board without modifying AIHUB source records. The AIHUB closeout calls a small machine-profile-aware runner after briefing synthesis. The Vite interface stays browser-testable while a Tauri shell owns the always-on-top, tray, hide, and quit behavior.

**Tech Stack:** Node.js ESM, Vite, strict TypeScript, CSS, Python standard library, Tauri 2, Rust.

## Global Constraints

- Never edit original diaries, worklogs, or canonical AIHUB indexes from Daybridge.
- Use the sanitized AIHUB closeout JSON; do not parse the human-facing Markdown report for normal operation.
- Keep computer-specific paths out of repository fixtures and AIHUB shared documents.
- Preserve Daybridge user status receipts when a board is regenerated.
- Do not turn `candidate_only`, unavailable coverage, `needs_review`, `not_evaluated`, or future/test artifacts into verified work.
- Show 3–5 parent quests first; keep lower-priority groups as support/backlog.

---

### Task 1: Add closeout-first compiler fixtures and tests

**Files:**
- Create: `scripts/compile-quests.test.mjs`
- Modify: `scripts/compile-quests.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: sanitized `aihub_briefing_synthesis` and `aihub_unified_daily_report` JSON.
- Produces: `compile({ sourceDate, targetDate, source: "closeout" })` board with grouped parent quests.

- [ ] Write a node:test fixture with duplicate SWIFT actions, a blocked item, an unconfirmed item, and an invalid future-date packet.
- [ ] Run `node --test scripts/compile-quests.test.mjs` and verify the unimplemented behavior fails.
- [ ] Export compiler helpers, group candidates by project/workstream, map conservative statuses, preserve existing receipts, and reject synthetic packets.
- [ ] Run `node --test scripts/compile-quests.test.mjs` and `node scripts/compile-quests.mjs --self-test`.

### Task 2: Connect compiler execution to AIHUB closeout safely

**Files:**
- Create: `04_Operations_And_Automation/Memory_System/conversation_bridge/daybridge_board.py`
- Modify: `04_Operations_And_Automation/Memory_System/daily_operator/daily_closeout_prompt.md`
- Modify: `04_Operations_And_Automation/Memory_System/scripts/environment_profile.py`
- Modify: `04_Operations_And_Automation/Memory_System/templates/environment_profile.template.json`
- Modify: `04_Operations_And_Automation/Memory_System/ENVIRONMENT_PROFILE.md`

**Interfaces:**
- Consumes: machine-local optional `daybridge_root`, closeout date, and Daybridge compiler CLI.
- Produces: AIHUB-owned `YYYY-MM-DD_daybridge_board.json` receipt plus local Daybridge board for the next working day.

- [ ] Add a self-tested runner that validates the optional local path, calculates the next weekday, invokes `pnpm compile:closeout`, and writes a sanitized receipt.
- [ ] Extend the local profile validator and template with an optional `daybridge_root` field; never place a real absolute path in a shared document.
- [ ] Call the runner after `briefing_synthesizer.py --phase closeout` creates the canonical action-first packet.
- [ ] Run the runner self-test and profile validation.

### Task 3: Build the compact floating quest surface

**Files:**
- Modify: `src/types.ts`
- Modify: `src/demo-data.ts`
- Modify: `src/main.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: grouped `QuestBoard` with source quality and main/support categories.
- Produces: a compact focus card, visible 3–5 quest route, status controls, check-in form, source quality indicator, and collapsible support queue.

- [ ] Add source-quality metadata to the board type and safe fallbacks for existing local data.
- [ ] Render the highest-priority parent quest as the “now” card and separate main from support quests.
- [ ] Add an accessible compact-mode toggle, source/quality notice, first-step controls, and preserved progress reporting.
- [ ] Implement the `Bridge Line` widget visual system: midnight ink, tide teal, lantern gold, violet signal, measured type scale, restrained motion, and reduced-motion support.
- [ ] Run strict TypeScript and the production build.

### Task 4: Scaffold the Windows widget shell and developer documentation

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/icons/.gitkeep`
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEBUGGING.md`

**Interfaces:**
- Consumes: the existing Vite development and build commands.
- Produces: a borderless, always-on-top Tauri window with tray show/hide/quit actions and browser-safe UI fallback.

- [ ] Add Tauri CLI/API dependencies and Vite watch exclusion.
- [ ] Configure a compact transparent window, tray feature, and least-privilege window capabilities.
- [ ] Add Rust tray controls that restore/focus the widget and hide on close until the explicit Quit command is used.
- [ ] Document browser debugging, closeout compilation, Tauri development, and Windows build prerequisites.
- [ ] Run `pnpm check`, `pnpm build`, compiler tests, then attempt `pnpm tauri build`; record any missing system prerequisite instead of treating it as a passing build.

### Task 5: Verify the running interface and record the handoff

**Files:**
- Create: `worklogs/2026-08-11_closeout_quest_widget.md`
- Modify: `PROJECT_STATUS.md`

**Interfaces:**
- Consumes: Vite preview and a generated fixture board.
- Produces: screenshot-backed UI verification and a source/verification/remaining-risk handoff.

- [ ] Start the Vite preview through the local web testing helper and load a fixture board through the bridge.
- [ ] Verify compact mode, status update, support queue, source notice, and console cleanliness with Playwright.
- [ ] Capture a visual screenshot, inspect it, and correct material UI defects.
- [ ] Add the verified results, Windows build prerequisite status, changed files, and next action to the worklog and project status.
