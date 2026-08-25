# Daybridge 교체 모션·휴지통 폐기 흐름

- 날짜: 2026-08-25 KST
- 범위: 시간표 카드 드래그 확장, 교체 위치 애니메이션, 카드 단위 폐기와 재배치 보존

## 설계 결정

- 드래그한 카드가 다른 카드 앞/뒤에 놓이면 대상 카드는 삽입 방향의 반대쪽으로 잠시 이동해 자리를 만드는 느낌을 준다.
- 드래그 중 하단에는 source 카드의 실제 높이를 복사한 휴지통 카드를 표시한다. 휴지통에 놓는 동작은 카드 하나의 50분 단위 폐기로 해석한다.
- 원본 AIHUB 보드·퀘스트는 삭제하지 않는다. schedule store에 `discardedBlocks`를 남기고 같은 날짜 재배치에서 해당 퀘스트의 남은 단위를 50분만큼 차감한다. 여러 단위 작업은 다른 카드가 유지된다.

## 수정

- source/target 카드에 짧은 swap 애니메이션을 추가했다. source는 들려 올라오고 target은 `before`일 때 아래로, `after`일 때 위로 이동한다.
- 드래그 중 실제 카드 높이를 측정해 휴지통 카드 높이에 전달하고, SVG 휴지통과 `여기로 폐기`/`놓으면 폐기` 상태를 표시한다.
- `POST /api/schedule/block-discard`와 schedule-store 폐기 로직을 추가했다. 완료·보류·스킵·비-focus 카드는 폐기할 수 없다.
- 폐기 receipt는 `schedule_block_discarded` 이벤트로 sanitized handoff sink에 기록한다.

## 검증

- `pnpm build`: 통과
- `python scripts/widget-smoke.py`: 통과. 고스트, 대상 카드 모션, swap role/animation, 동일 높이 휴지통, trash active, 폐기 요청과 카드 제거를 확인했다.
- `node --test --test-reporter tap`: 55/55 통과
- `node --test scripts/schedule-store.test.mjs scripts/schedule-move.test.mjs`: 8/8 통과
- `cargo fmt --check`, `cargo check --locked`: 통과
- 시각 QA: `test-artifacts/daybridge-schedule-overlay-swap.png`, `test-artifacts/daybridge-schedule-overlay-trash-active.png` 확인

## 남은 확인

- 실제 Windows release 창에서 손으로 swap·휴지통 drop을 관찰하는 단계는 Computer Use 중지 상태로 보류한다.
