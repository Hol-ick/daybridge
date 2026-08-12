# Action-list Integration Contract

## Purpose

This contract defines the sanitized, read-only quest board consumed by Daybridge. It prevents the interface from parsing a raw diary directly.

## Example

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-11T09:05:00+09:00",
  "activityDate": "2026-08-11",
  "sourceDate": "2026-08-10",
  "sourceCoverage": "connected",
  "sourceQuality": "aligned",
  "quests": [
    {
      "id": "stable-unique-id",
      "title": "Repair the guide reference link",
      "project": "Learning materials",
      "status": "not_started",
      "firstStep": "Compare the old link with its replacement.",
      "doneWhen": "The guide points to a working source.",
      "estimateMinutes": 20,
      "sourceLabel": "Daily note",
      "sourcePath": "relative-or-local-source-reference"
    }
  ]
}
```

## Constraints

- `schemaVersion` is currently `1`.
- `quests` contains parent workstream quests. Each parent keeps its extracted next actions as a checklist, so a fragmented closeout still starts with a short board.
- `sourceCoverage` can be `demo`, `connected`, `stale`, or `attention`; `sourceQuality` is `aligned`, `attention`, or `unknown` when known.
- `title`, `firstStep`, and `doneWhen` must be sanitized before writing this artifact.
- `sourcePath` must be a local or relative reference. It must never contain a credential, token, or personal identifier.
- `status` values are `not_started`, `in_progress`, `completed`, `blocked`, `paused`, and `needs_confirmation`.
- The compiler writes the file atomically and retains the last valid artifact when generation fails.
- `sourcePath` uses a safe identifier such as `diary://YYYY-MM-DD`; machine-local absolute paths never leave the source adapter.
- Each status report is written as a sanitized local event. The bridge mirrors it to AIHUB's `reports/daily/_system/daybridge_handoff/YYYY-MM-DD/` when the machine profile is available.

## Ranking

The initial compiler should prefer:

1. Explicit next actions with a completion condition
2. Direct requests whose owner or reply state needs confirmation
3. Blockers that can be turned into a small verification step
4. Carry-over actions confirmed by the user

It must penalize completed work, duplicates, generic policy statements, unsupported urgency, and evidence-free guesses.
