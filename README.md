# Daybridge

Turn daily notes into a focused next-day action list.

Daybridge is a local-first desktop companion. It reduces a detailed daily note to a short list of actions that can be started immediately, while keeping the source note read-only and traceable.

## What the first release includes

- A compact Windows floating widget that stays above other windows and lives in the system tray
- A concrete first step and a completion condition for every action
- One-click complete, progress, pause, block, and confirmation states
- Local status reports mirrored to an AIHUB handoff when the machine profile is available
- A link back to the evidence that produced each action
- Closeout-first generation: one workstream quest with a checklist, rather than every raw note line
- Freshness, record-quality, and source-coverage indicators instead of invented certainty

## Local development

Requirements: Node.js 22.12 or later and pnpm 11. The native Windows widget additionally needs Rust (MSVC target), Microsoft C++ Build Tools with the Windows SDK, and WebView2.

```bash
pnpm install
pnpm dev
```

`pnpm build` runs the strict TypeScript check and creates a production web bundle. `pnpm compile:closeout -- --source-date YYYY-MM-DD` reads one sanitized AIHUB closeout synthesis and writes the next-business-day board to the local Daybridge data directory. `pnpm bridge` compiles the current board and starts the local bridge; each status report is written locally and mirrored to AIHUB when the machine profile is available.

To run the always-on-top shell after the Windows prerequisites are installed:

```bash
pnpm dev:widget
```

## Data boundary

Daybridge does not edit the original daily note. The compiler creates a sanitized quest-board JSON artifact; the app writes status receipts only. AIHUB's `conversation_bridge/daybridge_handoff.py` folds those receipts into the 17:50 closeout and next morning briefing. See:

- [Architecture](docs/ARCHITECTURE.md)
- [Action-list contract](docs/INTEGRATION_CONTRACT.md)
- [Privacy boundary](docs/PRIVACY.md)
- [Roadmap](docs/ROADMAP.md)
- [Debugging guide](docs/DEBUGGING.md)
- [Contributing](CONTRIBUTING.md)

## Status

The closeout-first compiler, progress bridge, AIHUB handoff integration, and Tauri widget shell are implemented. The native installer build is blocked on this computer until Rust and the Microsoft C++ Build Tools are installed. Licensing and public release remain separate decisions.

## License

No open-source license has been selected yet. Do not reuse or redistribute the source until a license is added.
