# todometer renderer adoption

- Date: 2026-08-12 KST
- Status: implemented; native installer prerequisites remain pending

## Purpose

Replace the bespoke Daybridge card UI with a polished open-source desktop to-do renderer while keeping Daybridge's quest and AIHUB integration boundary.

## Implemented

- Audited `cassidoo/todometer` source and confirmed its MIT license, React/Electron implementation, progress meter, task-card spacing, dark palette, and completion animation patterns.
- Replaced the old vanilla TypeScript card renderer with a React renderer organized around todometer's `App`/`ItemList`/`Item`/`Progress` composition.
- Vendored and adapted todometer's CSS modules, variables, progress meter, date treatment, SVG controls, and completion response under `src/todometer/`.
- Connected the renderer to Daybridge's parent quest/sub-quest adapter, local receipt persistence, and AIHUB bridge reporting.
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

- The Electron application shell was not copied; the renderer and presentation assets were adopted inside the existing Tauri shell and Daybridge data flow.
- The adaptation is attributed in `THIRD_PARTY_NOTICES.md` and does not copy GPL-licensed Zebar or Rainmeter code.
- A completion click remains a user acknowledgement, not independent proof of task completion.
- Native Tauri packaging remains blocked by the existing Rust/MSVC/Windows SDK prerequisite.
