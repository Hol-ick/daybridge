# Daybridge

Turn daily notes into a focused next-day action list.

Daybridge is a local-first desktop companion. It reduces a detailed daily note to a short list of actions that can be started immediately, while keeping the source note read-only and traceable.

## What the first release includes

- A calm, always-available board for every extracted daily quest
- A concrete first step and a completion condition for every action
- One-click complete, progress, pause, block, and confirmation states
- Local status reports mirrored to an AIHUB handoff when the machine profile is available
- A link back to the evidence that produced each action
- Freshness and source-coverage indicators instead of invented certainty

## Local development

Requirements: Node.js 22.12 or later and pnpm 11.

```bash
pnpm install
pnpm dev
```

`pnpm build` runs the strict TypeScript check and creates a production web bundle. `pnpm compile` reads the previous KST work diary without editing it and writes the next quest board to the local Daybridge data directory. `pnpm bridge` compiles the board and starts the local bridge; each status report is written locally and mirrored to AIHUB when the machine profile is available.

## Data boundary

Daybridge does not edit the original daily note. The compiler creates a sanitized quest-board JSON artifact; the app writes status receipts only. AIHUB's `conversation_bridge/daybridge_handoff.py` folds those receipts into the 17:50 closeout and next morning briefing. See:

- [Architecture](docs/ARCHITECTURE.md)
- [Action-list contract](docs/INTEGRATION_CONTRACT.md)
- [Privacy boundary](docs/PRIVACY.md)
- [Roadmap](docs/ROADMAP.md)
- [Debugging guide](docs/DEBUGGING.md)
- [Contributing](CONTRIBUTING.md)

## Status

The quest board, deterministic diary compiler, progress bridge, and AIHUB handoff integration are implemented. A Windows shell, licensing, and public release remain separate decisions.

## License

No open-source license has been selected yet. Do not reuse or redistribute the source until a license is added.
