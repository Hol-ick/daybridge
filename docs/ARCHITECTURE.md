# Architecture

## Product shape

Daybridge has five deliberately separated layers:

1. **Closeout source adapter** — reads the sanitized `*_briefing_synthesis.json` produced by AIHUB closeout. A daily diary is only a local fallback when no closeout exists.
2. **Action compiler** — filters completed/policy-only text, keeps uncertainty as a status, and groups related actions into parent workstream quests with checklists.
3. **Local state** — keeps the user’s status, checklist, and progress-report receipts outside source notes.
4. **Desktop surface** — renders a compact focus card and an expanded quest board with achievement feedback and easy status changes.
5. **AIHUB handoff** — mirrors sanitized reports for the 17:50 closeout and next-morning briefing.

The first repository milestone implements the desktop surface as a browser-preview interface with demo data. A Windows Tauri shell will wrap the same interface only after the compiler contract is proven.

## Data flow

```text
AIHUB closeout synthesis
        ↓ read-only, action-first
action compiler
        ↓ grouped parent quests + local board
Daybridge widget / browser preview
        ↓ local event + optional AIHUB mirror
status / progress / next-action history
        ↓ 17:50 closeout
AIHUB morning handoff
```

## Action quality rules

An action must:

- describe a concrete action, not a completed event or a policy statement;
- provide a first step that can normally begin within 15 minutes;
- state a completion condition;
- retain a source reference;
- be assigned `ready`, `needs-confirmation`, or `waiting`;
- be safe to display in a desktop context after sanitization.

The compiler must reject source sentences such as “do not finalize this yet” unless it can convert them into a verifiable action, for example “identify the official evidence needed before finalizing.”

## State ownership

| Data | Owner | May Daybridge edit it? |
|---|---|---:|
| Original daily note | Existing note system | No |
| Generated action-list JSON | Action compiler | Yes, atomically; preserve user receipts by quest ID |
| User interaction receipt | Daybridge local storage | Yes |
| Canonical project memory | Existing memory system | No |

## Desktop packaging

The Windows shell uses Tauri:

- frameless, transparent, always-on-top compact window;
- system-tray show, hide, and explicit quit actions;
- a close button that hides to the tray instead of ending the process;
- browser-safe fallback for the same Vite interface;
- no cloud account in the first release.
