# AIHUB → Daybridge Quest Plan Contract

The closeout report remains detailed. A separate extractor writes the derived plan consumed by Daybridge.

```json
{
  "artifact_type": "daybridge_quest_plan",
  "schema_version": "1.0",
  "activity_date": "2026-08-12",
  "status": "ready",
  "source": { "closeout_ref": "aihub://2026-08-12/closeout", "coverage": "aligned", "quality": "aligned" },
  "quests": [{
    "id": "quest-stable-id",
    "mission_id": "mission-stable-id",
    "title": "Check the official source",
    "actor": "user",
    "kind": "review",
    "priority": "must",
    "execution": "sequential",
    "depends_on": [],
    "state": "ready",
    "current_action": "Open the source",
    "done_when": "The result is recorded",
    "estimate_minutes": 15,
    "progress": { "completed": 0, "total": 2 },
    "carryover_count": 0,
    "steps": [{ "id": "step-1", "label": "Open the source", "completed": false }],
    "source_refs": ["record://worklog/123"]
  }],
  "excluded": [{ "title": "Check the next automation run", "reason": "automation monitoring" }]
}
```

Rules:

- `actor=user` and `kind` in `execute`, `review`, or `decision` are eligible for the widget. Automation monitoring, Codex work, policy-only text, and external work remain in `excluded`.
- There is no three-item cap. All eligible atomic quests are retained; the UI focuses them into sections.
- IDs must remain stable across dates. Existing Daybridge receipts are merged by `quest.id` and step ID.
- A sequential quest may lock a step until its declared dependency is complete. Independent quests remain available in parallel.
- States: `ready`, `in_progress`, `deferred`, `blocked`, `completed`. Legacy `not_started` and `paused` are accepted only as compatibility inputs.
- Source text is sanitized and source paths are safe references; machine-local paths and secrets never enter the plan.
- The compiler writes boards atomically. The bridge writes sanitized receipt events to `reports/daily/_system/daybridge_handoff/YYYY-MM-DD/`.
