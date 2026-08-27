# 2026-08-27 — Runtime inbox refresh

## Context

The direct-session schedule inbox accepted `Swift 재기동 매뉴얼 1차 보완`, and
the local bridge returned a valid `13:00–13:50` focus block. The packaged
widget still showed an empty list.

## Root cause

The running `daybridge.exe` had started before the bridge and before today's
inbox existed. Its persisted board was dated `2026-08-25`. When the initial
board request failed, `ScheduleSurface` used that stale board date for every
schedule request, so it queried the empty `2026-08-25` schedule instead of
today's valid inbox-backed schedule.

## Change

`ScheduleSurface` now resolves its activity date from the current KST date for
the today view. A small unit-tested helper prevents a stale persisted board
from selecting an earlier schedule.

## Verification target

After rebuilding and restarting the packaged widget, the running overlay must
show `Swift 재기동 매뉴얼 1차 보완` from the date-scoped inbox. The bridge API
and inbox parser remain unchanged.
