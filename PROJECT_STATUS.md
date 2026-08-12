# Daybridge Project Status

- Status: active
- Last updated: 2026-08-12 KST
- Repository: https://github.com/Hol-ick/daybridge

## Objective

Turn the AIHUB closeout into a small, evidence-linked next-business-day quest board that stays visible as a calm Windows widget without changing the original notes.

## Current milestone

M2 implemented in source: detailed-closeout → separate Quest Extractor → stable Quest Plan → carryover-aware compiler/bridge → compact sequential quest widget. The todometer-based renderer and Tauri always-on-top shell remain the presentation layer.

## Verified progress

- The Quest Extractor keeps the full closeout as source evidence, removes the fixed three-item limit, classifies user execution/review/decision work, and keeps automation/Codex/policy items in an auditable excluded list.
- Missions and quests use stable IDs. The compiler preserves step receipts and increments carryover when unfinished work reaches a new board date.
- Explicit `depends_on` and sequential execution lock only the declared next step; independent quests remain parallel.
- The AIHUB closeout runner now creates the derived Quest Plan before compiling the following business day's local board.
- The desktop surface shows compact parent quest cards; clicking one expands a full-width detail area below that card's action row with its summary, done-when line, and compact sub-quest cards. Only one parent card can be open at a time.
- The former Daybridge-specific card renderer has been replaced by an adapted todometer React renderer: its progress meter, dark palette, task-card rhythm, CSS-module structure, SVG controls, and completion response are used directly. Daybridge keeps the quest adapter, parent/sub-quest data model, AIHUB bridge, and Tauri shell around that renderer. The reuse boundary and attribution are recorded in `THIRD_PARTY_NOTICES.md`.
- Manual status, check-in, source, achievement, project, XP, and connection-copy UI remain hidden. The compact card supports progress, completion, `내일 계속`, resume, and sequential sub-quest receipts.
- The accordion unfold, staggered sub-quest reveal, and completion response respect reduced-motion preference. The isolated browser smoke check confirms the collapsed default, single-card expansion, sub-quest completion, and absence of removed controls.
- The Tauri shell defines a transparent frameless always-on-top window plus tray show/hide/quit behavior. Closing the window hides it to the tray.
- TypeScript, production Vite build, compiler tests, runner/profile self-tests, local bridge syntax, and browser smoke/visual checks passed. The card-deck smoke check was run against an isolated preview fixture.

## Current blocker

The native Windows installer is not yet buildable on this computer because Rust/Cargo and Microsoft C++ Build Tools with the Windows SDK are not installed. WebView2 is available.

## Next actions

1. Install the Windows native build prerequisites, then run `pnpm build:widget` and test tray/always-on-top behavior.
2. Use several real closeouts to tune broad evidence sentences and project grouping without losing source provenance.
3. Decide public-release packaging policy before publishing an installer; the current renderer reuse boundary is documented and attributed.

## Boundaries and risks

- Original diaries, worklogs, closeout sources, and canonical indexes remain read-only to Daybridge.
- A user click is a status receipt, not independent proof of task completion.
- The machine-local Daybridge checkout and Node runtime paths must never enter repository fixtures or shared AIHUB documents.
- Public release, telemetry, cloud sync, authentication, and licensing remain separate decisions.
