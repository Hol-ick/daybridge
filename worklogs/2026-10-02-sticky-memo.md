# Sticky memo implementation checkpoint

## Scope and current state

Implement the canonical MARU plan `2026-10-02-daybridge-sticky-memo.md`: minimal Ctrl+D note, draft autosave, local archive on successful close, blank next invocation, recovery and content-free diagnostics.

This checkpoint adds the storage and frontend session foundations. The native application still uses its existing memo commands and UI. No operating installation, user data, startup configuration or login checker was changed.

## Changes

- `memo_store.rs` serializes access with a Windows no-share handle, validates disk state and session revisions, synchronizes temporary writes, and replaces state only after a complete write.
- Close persists an archive intent, atomically publishes a non-overwriting archive, and records a receipt before clearing the draft. Retries reconcile the same archive. Failure preserves the previous saved draft or pending intent.
- Archive publication uses a same-volume hard link rather than adding another Windows API dependency. A preexisting destination is compared byte-for-byte and never replaced. Unsupported filesystems fail safely; actual app-local filesystem compatibility remains an installation verification requirement.
- Legacy import uses a fixed ID and metadata so publication before a marker update can be retried without duplicating or mutating the original.
- Autosave gains a waitable flush and disposal. The session controller adds debounce/max-interval saves, snapshot ACK validation, single-close coordination, blank reopening and retry without repeating a successful archive.
- After archive finalization is requested, input stays frozen until its result is reconciled. This prevents new edits from racing with a possibly published archive; failure before finalization keeps editing available. The content stays visible for retry.

## Validation

- Rust storage tests: 10 passed, including five close I/O failure points, real state-write failure, Windows live-lock contention, corrupt state preservation, interrupted publication, Unicode/size/revision checks and legacy retry.
- Full Rust regression: 29 passed.
- Frontend autosave/session tests: 10 passed, including an in-flight save followed by immediate close and rejection of the wrong ACK. TypeScript check and tracked diff whitespace check passed.

## Remaining

Connect the repository and migration to memo commands; replace the decorated memo UI; route X/Esc/Alt+F4 and all explicit app exits through finalization; add tray archive entry and metadata-only events; update browser smoke tests; verify rendered/native Windows flows, release/NSIS/install payload and CI; deliver within the authorized operating scope. The older Windows login/tray reliability verification remains separate.
