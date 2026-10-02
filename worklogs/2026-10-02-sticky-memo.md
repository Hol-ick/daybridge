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

## Operating upgrade and background lifetime repair

- The verified b439e8d installer payload was applied to the operating executable with a private backup, preserved legacy memo and unchanged schedule data location. Its CI run36969729916 completed successfully. Native metadata recorded one-time legacy import and a real memo archive; this is storage evidence, not proof of every UI close gesture.
- The user reported that Ctrl+D stopped and the widget disappeared. Native events and the explicit-exit marker identified dashboard CloseRequested as the trigger: the inherited handler exited the whole application. The tray and global shortcut necessarily disappeared with it. The bundled bridge remained orphaned and was stopped only after validating its executable, PID and parent against the operating receipt.
- Non-memo window close now prevents destruction and hides that window. Explicit tray/API quit still finalizes any active memo before setting the watchdog exit marker. The management header now offers the same fixed-directory archive action as the tray. README clarifies these semantics.
- Fresh Rust30/30 and memo JS10/10 passed. TypeScript/frontend build, Windows release/NSIS and installer payload independent checks10 passed. Final repaired payload executable SHA256: b8f55d0161cab2a5ae8232e88bf705c77f037e52072a7dc80da7b544e5a36b89; NSIS SHA256: 19ca6683e4a2206ee706ac0d5ca31bfbb74aa0c28f62a5c9e2b691a2def0ffc4.
- Repaired payload is installed and matches its receipt; owned bundled bridge, original data location, legacy memo preservation, startup readiness and surface mounts were verified. Ctrl+D from another app opened the installed memo. Physical Escape interrupted Computer Use before full screen inspection; automated UI actions stopped immediately. Later read-only logs show repeated empty native sessions closing while the repaired process remains alive, but do not establish all gestures or widget visibility.
- Remaining: user/native confirmation of dashboard close with persistent widget and repeated Ctrl+D, archive button, final Korean IME/X/Esc/Alt+F4 and tray exit checks, and the repaired source CI result. Deferred normal Windows login remains separate; no logoff/reboot was performed. Goal remains active.

## Archive entry placement correction

- The user confirmed repeated Ctrl+D now works, but specified that the archive entry belongs in the expanded widget, not the management dashboard. Moved the text-labelled button between manual add and settings in the existing footer, preserved footer height, and hides utility buttons while the manual entry form is open. The fixed native archive directory command and tray entry remain the same.
- Isolated browser checks at scales100/150/200% verified visible untruncated label,38px target height, callback execution and manual form layout. All three had zero console errors; captured layout visually inspected. These browser checks do not establish native Explorer launch.
- TypeScript/frontend build, Windows release/NSIS and payload independent checks10 passed. Updated installed executable from the verified payload with an owned-process guard and private backup, preserving the memo file and owned bundled bridge. A first attempt detected an active memo and deferred; after the draft closed, the guarded update completed.
- New installed payload SHA256 d4804e3db8122669a65f2c9e097d376a2049b2ab7810d05d62adff611cb8cf21. NSIS SHA256 f787a3f0d21491b480ac2c0b4916da3bf947fdf335eb375fe983b6025d34934f. Actual archive button/native folder opening awaits user confirmation.
- Previous close-repair source5f2af44 CI36971691923 failed1 of178: rapid cross-process lock handover worker reached its25s fixture deadline. Logs identify the failure; do not classify it as an environment-only issue or claim the whole CI passed. No unrelated storage implementation was changed. Follow the final placement revision CI independently.

### Equal icon buttons

- The user saw the expanded-widget archive entry and requested an icon matching the adjacent add/settings controls. Replaced the text with an outlined archive box SVG and accessible name/tooltip; all three columns now share equal width and38px height. Manual form expansion still hides both utility icons.
- Browser checks at100/150/200% verify equal button bounds, archive callback, preserved manual form and zero page errors; the rendered screenshot was inspected. TypeScript/frontend, Windows release/NSIS build and installer payload independent checks passed. Native archive opening still requires direct confirmation; no Computer Use actions resumed after interruption.
- The previously failing cross-process handover test passed a fresh local reproduction in6.23s. This does not explain the remote25s deadline failure or prove that it was fixed. Keep remote final-source status separate.

## Internal widget archive

- The user confirmed the installed Ctrl+D and close/archive/reopen flows work, but clarified that the archive must be a Daybridge screen with selected-note actions. Replaced Explorer navigation with an internal list/detail panel in the widget; tray routing emits the same internal-open event. The three equal footer icons remain unchanged.
- Native archive commands validate fixed-directory IDs, bounded UTF-8 files and metadata. Lists page at100 items; damaged files are preserved and counted. Delete moves to local trash, repeated delete is consistent, and restore rejects conflicting targets. Export uses the existing pinned Windows0.61.3 native save dialog, writes an independent UTF-8 text file, protects app state paths and logs only action/outcome including cancellation.
- Selected-note actions export text, confirm/edit a proposed title and use the existing today-task endpoint, or confirm deletion with undo. Schedule registration preserves the source memo; it registers the confirmed title rather than attaching the full body. Async reads ignore stale selections and actions suppress duplicate submission. Esc closes the internal panel.
- Fresh full Node183/183 passed before adding two further archive cancellation/failure cases; final archive controller7/7 passed. Fresh Rust33/33, type/frontend build, Windows release/NSIS and installer payload independent10 checks passed. Payload SHA25675795ade917e3e9f4248dd2d9be825266bbee244bc4e9037112a380b25c29cd1; installer SHA256b7089e1778643542af30098feb2d6a5949ec1507f3f8e55b928dcf09524607ae.
- Isolated browser flows at760px scales100/150/200% and420px verified exact Korean read, HTML treated as text, file download contents, schedule callback once, delete cancel/confirm/undo, and Esc return. Empty list also verified. Captures inspected for layout; all four flows had zero page errors. An initial test harness used a separate React module and failed hook initialization; corrected the fixture to normal Vite imports and reran successfully. This was not an operating-app failure.
- Previous icon revision2b3420f Actions36972549934 completed/success, read through GitHub API. The new source requires a separate CI result and installed native internal archive validation. No desktop automation resumed after the physical Escape interruption; user operating confirmation remains separate from browser/native repository evidence. Goal active until the added operating acceptance is confirmed.

## Direct Downloads export and independent archive window

- User confirmed schedule registration works, then requested immediate deletion without confirmation/undo, direct TXT saving to Downloads followed by removal, and an archive that does not replace the schedule widget. These override the earlier confirm/trash UI plan; existing historical trash files remain preserved. Native archive APIs now permanently delete only the selected validated archive.
- Export resolves the Windows Downloads known folder natively. It publishes a synced UTF-8 file under a fixed ID name without replacing unrelated contents, verifies exact bytes, then removes the source. Write/conflict failure keeps the source. A saved file with failed source removal returns a partial result, logs it distinctly and permits retry against the same file. Removed the save dialog and restore command/UI.
- A separate hidden archive WebView opens beside the schedule widget; opening it no longer sets the overlay settings canvas or hides the schedule. Archive visibility pauses overlay blur-collapse, and schedule registration emits a content-free event so all schedule windows refresh immediately. Closing hides only the archive. Window capability scope includes the new native surface.
- Fluent official guidance informed250ms entry,167ms content/layout transitions and83ms exit, with native Web Animations FLIP for list compaction and reduced-motion fallback. References: https://fluent2.microsoft.design/motion and https://learn.microsoft.com/en-us/windows/apps/design/motion/timing-and-easing . No animation dependency was added.
- Fresh full Node187/187, final Rust36/36, type/frontend and Windows release/NSIS build passed. Rust covers exact Korean TXT, immediate purge, export conflict/write failure, partial removal and duplicate-free retry, pending intent and corrupt-file preservation. Controller covers failed/partial export and StrictMode reconnection.
- Five isolated browser popup flows passed:720px scales100/150/200%,420px and reduced motion. They verify StrictMode rendering, exact downloaded bytes, automatic source removal, one-click deletion with no confirm/undo controls, schedule callback updating a still-visible overlay, close and console errors0. Rendered screenshots inspected. The first popup fixture populated the wrong schedule field and an ambiguous text locator; fixed the fixture and reran. The native Windows window placement, actual Downloads export and operating schedule refresh still require operating confirmation.
- Prior internal archive revisiona831a3e Actions36975171680 completed/success. Current source requires its own remote result. Canonical plan section9 records the changed acceptance; goal remains active through operating verification. No desktop automation resumed after the earlier interruption.
