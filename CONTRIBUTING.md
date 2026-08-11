# Contributing to Daybridge

## Development loop

1. Keep diary and AIHUB source records outside the repository.
2. Run `pnpm check` and `pnpm build` before committing.
3. Use `pnpm compile -- --print` to inspect extraction changes without changing source notes.
4. Keep status reports sanitized and preserve the distinction between user-reported completion and independently verified work.
5. Add a short dated worklog after material changes.

## Privacy boundary

Do not commit diary content, customer data, credentials, `.env` files, local absolute paths, generated Daybridge boards, or AIHUB reports. The repository stores only safe source identifiers such as `diary://YYYY-MM-DD`.

## Commit scope

Stage named files only. Keep generated `dist/`, `node_modules/`, local logs, and machine-specific configuration out of commits.
