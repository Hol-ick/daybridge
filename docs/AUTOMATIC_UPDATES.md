# Automatic Windows updates

The installed app checks the stable GitHub Release endpoint after one minute and every four hours. It accepts only a newer SemVer, the exact versioned asset in this repository, HTTPS transport, and a valid updater signature. The pinned updater plugin is compatible with the existing Tauri 2.11 runtime; the signature is checked again by the native installation supervisor before it touches program files.

Applying waits for two minutes without keyboard/mouse input, a collapsed widget, hidden archive and management windows, no settings dialog, and no active or pending memo on disk. A download does not close an editor. The memo store lock and a short handoff gate prevent a new memo session from racing with shutdown. Explicit exit markers let the existing process watchdog stand down before installation. No Windows restart or logoff is requested.

The supervisor is a copy of the installed native executable in the application's local update cache. Its `--apply-update` entry point runs before UI initialization and accepts only a plan under that cache, the canonical per-user installation, the existing memo and storage-pointer paths, and the exact parent executable/creation time. It keeps handles to the old owned bridge rather than killing arbitrary listeners. It does not require PowerShell scripts or a change to execution policy.

The supervisor inventories and verifies a backup of program files, checks memo-file hashes and the storage pointer, waits for the old app to exit, and runs the signed NSIS package silently. The new app must report its expected version, process ID, transaction token and all three mounted surfaces, with its own bundled bridge responding. If installation or startup fails, the supervisor restores verified program files and launches the previous app. It never restores an entire user-data directory over newer notes or settings. A memo opened during a failed startup defers termination; a still-running installer also stops rollback rather than restoring files underneath it. The failed version is quarantined after an attempted installation.

An interrupted supervisor or an installer that does not exit requires diagnosis using the cache receipt. Full power-loss/Windows-reboot recovery is outside the verified acceptance of this change. Backups and failure receipts are retained for recovery; they contain private local paths and must not be committed or uploaded.

## Publishing

`Publish Daybridge update` runs after successful `Verify Daybridge` on main. It skips commits already represented by the latest release and refuses to publish a stale main revision. `scripts/release-update.mjs prepare` derives a distinct patch version from the commit count and updates package JSON, Tauri config, Cargo manifest and lockfile together. The release job builds a signed installer, executes the extracted payload verification, and generates `latest.json` only from the matching verified bytes. Assets are uploaded to a draft before that release becomes latest. Published versions are immutable; failed builds do not become an update.

The updater public key is committed. The private key is an Actions secret and a Windows-current-user DPAPI-protected local developer file. `scripts/signing-environment.mjs` unlocks the local file only into build-process memory. Do not regenerate the key for routine releases, print it, or commit it. Losing the signing identity prevents updates to existing installations.

Useful evidence:

- Native runtime events: `app_started` includes version and source revision; `app_updater_started`, `app_update_available`, `app_update_signature_verified`, `app_update_handoff`, `app_update_startup_verified`, `app_update_error` and `app_update_quarantined` describe update progress without note text or signing secrets.
- Per-transaction `result.json`: backup, install, startup, completion or rollback outcome.
- Existing `storage-location.json` remains the authority for user data.

Older installations contain no updater. They require one transition installation; afterward normal verified releases are applied by the app. Code completion, release publication, transition installation and a witnessed update to a higher version are separate acceptance steps.

References: [Tauri updater](https://v2.tauri.app/plugin/updater/), [Tauri GitHub distribution](https://v2.tauri.app/distribute/pipelines/github/).
