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

## Native and minimal surface integration checkpoint

- Connected the repository, one-time migration, begin/save/finalize/hide commands and tray archive directory. The old unguarded single-file commands are removed.
- The memo window is 360×360, minimum 280×220, without native title chrome; it has one writing surface, a 28px close target, a separate drag region and error-only guidance.
- X/Alt+F4 are prevented until the renderer flushes and finalizes. Esc and the close button share that path. Tray/dashboard/overlay explicit exits request memo finalization before the existing watchdog exit marker and application exit.
- The native hide command requires a completed close receipt. Renderer failure never fabricates this receipt. A queued reopen gets a new native session and shows the window after successful close.
- Memo diagnostics contain only controlled IDs, revision, byte count, duration, outcome and allowlisted error codes. Logging failure has an independent health flag and nonrecursive recovery count; raw paths/errors and body content are excluded.
- Browser preview uses a separate v2 draft/archive key and never reads native notes or the old preview key. It models blank reopening and draft recovery independently of the native filesystem.

### Fresh validation

- Node full regression: 178/178 passed.
- Final Rust regression: 30/30 passed, including 11 repository cases and metadata/log-failure tests. The two old single-file helper tests were replaced by repository coverage.
- Autosave/session tests: 10/10 passed; type check, frontend build and diff checks passed.
- Browser smoke: 11 checks passed, covering immediate final snapshot, blank reopen, distinct repeated notes, whitespace close, crash-like reload recovery, read/write failure preservation, retry and bridge independence.
- Rendered captures inspected at 360×360 and 280×220 with 100/150/200% device scales. Normal, long mixed-language, save-error and read-error states captured; no horizontal/page overflow. Textarea scroll clipping in long text is its own content scroll area.
- First browser attempt could miss focus before React enabled the textarea. Added a commit-time focus effect, then reran successfully. The original server helper could not launch the PowerShell pnpm shim through its shell; direct Node/Vite worked, and the owned preview process was stopped afterward.
- Windows release/NSIS build succeeded. Installer payload verifier passed 10 independent bridge/package checks. These do not prove native memo input, real installation or Windows login.
- Previous foundation source33ff37d Actions36968234473 completed/success. The current integration source needs its own remote result.

### Remaining acceptance

Real Windows Ctrl+D/IME/X/Esc/Alt+F4/tray quit and reopen; archive contents and runtime events under the installed app; operating upgrade backup/ownership/recovery and unchanged data continuity; login checker expectations for the new source; current integration CI. Product goal remains active. Operating installation and user files were not changed during this checkpoint.
