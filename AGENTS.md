# Daybridge Working Rules

- Treat source notes and worklogs as read-only evidence. Do not modify them from the application.
- Keep machine-specific paths, customer names, credentials, and personal data out of the repository and fixtures.
- Build the action compiler against sanitized fixtures before connecting any local diary integration.
- A completion click records a user acknowledgement; it must not promote an item to independently verified completion.
- Keep UI work independent from the Windows shell. The browser preview remains the fastest regression surface.
- Add a worklog in `worklogs/` after material implementation, research, release, or multi-file changes.
- The user grants standing authorization to stage, commit, merge, and push repository changes without asking again, with `origin/main` as the final delivery target. Treat the current worktree and branch history as the working scope, move changes to `main` automatically, and resolve ordinary merge conflicts using a recoverable checkpoint-first flow. If the current branch differs, checkpoint it, integrate it into `main`, verify, and push. Retry ordinary push failures a limited number of times and report only authentication, permission, protection, or unrecoverable conflicts. Exclude only obvious secrets. Never force-push or open a pull request automatically.
