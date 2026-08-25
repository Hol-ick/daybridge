# Daybridge 오버레이 드래그 고스트 피드백

- 날짜: 2026-08-25 KST
- 범위: 카드 드래그 중 이동 상태를 알아보기 어려운 문제의 원인 추적과 시각 피드백 추가

## 원인

- 기존 구현은 드래그 원본 카드의 투명도와 크기만 바꿨다.
- 마우스 좌표를 따라가는 시각적 객체가 없어서, 카드가 실제로 잡혔는지와 어느 위치에 놓일지 사용자가 확인하기 어려웠다.

## 수정

- 드래그 임계값을 넘는 순간 원본 자리는 낮은 대비·점선 슬롯으로 유지한다.
- 포인터가 카드를 잡은 지점을 기준으로 카드 복제본을 absolute 고스트로 만들고, surface 좌표계에서 마우스 좌표를 따라 이동시킨다.
- 고스트에는 회전, 확대, 그림자, 초록색 테두리, `이동 중` 상태를 적용해 들어 올려진 카드처럼 보이게 했다.
- 고스트는 `pointer-events: none`으로 두어 드롭 대상 계산과 원래 카드 이벤트를 방해하지 않게 했다.

## 검증

- `pnpm build`: 통과
- `python scripts/widget-smoke.py`: 통과. mouse drag 시작 후 고스트 존재, `position:absolute`, 높은 opacity, `pointer-events:none`, 드래그 종료 후 제거를 확인했다.
- `node --test --test-reporter tap`: 53/53 통과
- `cargo fmt --check`, `cargo check --locked`, `git diff --check`: 통과
- 시각 QA: `test-artifacts/daybridge-schedule-overlay-dragging.png`에서 마우스 추적 고스트, 원본 점선 슬롯, 하단 버튼 행을 확인했다.

## 남은 확인

- Computer Use를 통한 실제 Windows release 창 손동작 관찰은 사용자의 Escape 중지로 이번 턴에는 실행하지 않았다. 브라우저 smoke와 렌더 캡처는 통과했다.
