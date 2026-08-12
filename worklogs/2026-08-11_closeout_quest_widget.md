# Closeout Quest Widget

- Date: 2026-08-11 KST
- Status: implemented; native installer prerequisite remains blocked

## Purpose

Turn the AIHUB closeout's action-first synthesis into a compact, always-visible next-day quest board instead of showing every raw daily-note fragment.

## Implemented

- Reworked `scripts/compile-quests.mjs` to prefer a validated AIHUB closeout synthesis, reject future/test packets, retain a diary fallback, and group related actions into project/workstream parent quests with checklists.
- Added deterministic compiler coverage for business-day rollover, grouped actions, retained receipts, future packet rejection, and concise long card-evidence titles.
- Added the AIHUB `daybridge_board.py` runner and machine-local profile fields so closeout compiles the next business day's board after briefing synthesis while writing only a redacted receipt back to AIHUB.
- Rebuilt the Vite interface as a compact/expanded floating widget with achievement feedback, status changes, checklist receipts, a check-in form, source-quality feedback, and browser-safe behavior.
- Added the Tauri 2 desktop shell: transparent frameless always-on-top window, tray show/hide/quit, hide-on-close behavior, icon assets, and minimal window capability.

## Verification

- `pnpm check` passed.
- `pnpm build` passed.
- `pnpm test:compiler` passed: 4 tests.
- `node --check scripts/local-bridge.mjs` passed.
- AIHUB environment-profile validation and `daybridge_board.py self-test` passed.
- The real 2026-08-10 closeout generated the 2026-08-11 board with an AIHUB-ready receipt.
- Browser smoke test passed through the local bridge and Vite server. The inspected screenshot confirms compact-to-expanded interaction and the progress-report drawer.
- `pnpm tauri info` confirms WebView2 but reports missing Rust/Cargo and Microsoft C++ Build Tools. `pnpm build:widget` is therefore blocked before Rust compilation.

## Important decisions

- AIHUB closeout synthesis is the normal source of truth; raw diaries are only a conservative fallback.
- A parent quest represents one workstream and checklist rows retain the smaller actionable fragments. This avoids a fragmented morning board while keeping all next actions visible.
- The native widget hides to the tray when closed; explicit Quit is available from the tray menu.

## Remaining work

1. Install the Rust MSVC toolchain and Microsoft C++ Build Tools/Windows SDK before building the installer.
2. Validate tray, hide, and always-on-top behavior on the native shell.
3. Tune extraction after more real closeouts, especially for long evidence-oriented action sentences.
