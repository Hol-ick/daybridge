# Privacy Boundary

Daybridge is local-first in its initial release.

## It will do

- Read a sanitized, generated action-list artifact.
- Store completion, deferral, and exclusion receipts locally.
- Show the smallest useful task title, first step, and completion condition.

## It will not do

- Upload diary contents by default.
- Edit original daily notes, project worklogs, or canonical memory.
- Store credentials, authentication codes, account details, or raw email bodies.
- Treat a user click as independently verified work completion.

## Display safety

Desktop widgets can be visible to someone nearby. The compiler must remove or generalize client names, sender addresses, account numbers, tokens, attachment names, personal identifiers, and other sensitive details. If safe reduction is not possible, the item is excluded and marked for review in the source system.

Cloud sync, telemetry, account login, and external AI calls are out of scope until the data flows and consent language are explicitly designed.
