# todometer UI adaptation

- Date: 2026-08-12 KST
- Status: implemented; native installer prerequisites remain pending

## Purpose

Reuse a polished open-source desktop to-do visual language instead of rebuilding progress meters, task-card rhythm, and completion feedback from scratch.

## Implemented

- Audited `cassidoo/todometer` source and confirmed its MIT license, React/Electron implementation, progress meter, task-card spacing, dark palette, and completion animation patterns.
- Adapted the todometer visual layer into Daybridge's existing vanilla TypeScript/Tauri surface.
- Added an aggregate daily progress meter and compact date label while preserving the single-open parent quest accordion.
- Restyled parent cards, expanded details, and sub-quest controls with the adapted dark palette, meter treatment, task-card spacing, and completion pulse.
- Kept Daybridge's AIHUB closeout compiler, local bridge, automatic progress receipt, parent/sub-quest schema, and isolated-browser bridge abort unchanged.
- Added `THIRD_PARTY_NOTICES.md` with the upstream attribution and MIT notice.

## Verification

- `pnpm check` passed.
- `pnpm build` passed.
- `pnpm test:compiler` passed: 4 tests, 0 failures.
- Browser smoke passed with a real Chromium executable: collapsed default, single-card expansion, summary rendering, sub-quest completion, removed-control check, and no page errors.
- Visual inspection confirmed the dark meter-based widget surface and compact accordion hierarchy.
- `git diff --check` reported no whitespace errors; Git emitted only line-ending warnings.

## Decisions and boundaries

- The Electron application shell was not copied; only compatible presentation patterns were adapted to the existing Tauri shell and Daybridge data flow.
- The adaptation is attributed in `THIRD_PARTY_NOTICES.md` and does not copy GPL-licensed Zebar or Rainmeter code.
- A completion click remains a user acknowledgement, not independent proof of task completion.
- Native Tauri packaging remains blocked by the existing Rust/MSVC/Windows SDK prerequisite.
