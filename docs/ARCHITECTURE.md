# Architecture

## Product shape

Daybridge has four deliberately separated layers:

1. **Source adapter** — reads a permitted local note or handoff artifact.
2. **Action compiler** — extracts, filters, deduplicates, ranks, and validates action candidates.
3. **Local state** — keeps the user’s status, checklist, and progress-report receipts outside source notes.
4. **Desktop surface** — renders every quest with achievement feedback and easy status changes.
5. **AIHUB handoff** — mirrors sanitized reports for the 17:50 closeout and next-morning briefing.

The first repository milestone implements the desktop surface as a browser-preview interface with demo data. A Windows Tauri shell will wrap the same interface only after the compiler contract is proven.

## Data flow

```text
daily note / handoff
        ↓ read-only
action compiler
        ↓ validated quest board
Daybridge interface
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
| Generated action-list JSON | Action compiler | Yes, atomically |
| User interaction receipt | Daybridge local storage | Yes |
| Canonical project memory | Existing memory system | No |

## Desktop packaging

The target shell is Tauri on Windows:

- frameless, compact window;
- optional always-on-top behavior;
- system-tray access and autostart;
- persisted widget position;
- no cloud account in the first release.
