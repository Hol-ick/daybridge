# Daybridge 드래그 대상 카드 모션 피드백

- 날짜: 2026-08-25 KST
- 범위: 드래그 고스트가 대상 카드 위에 놓일 때 삽입 위치와 대상 상태를 더 명확하게 표시

## 관찰

- 고스트 카드는 마우스를 따라 움직였지만, 대상 카드에는 정적인 테두리와 배경색만 적용되어 어느 카드에 삽입되는지 즉시 인식하기 어려웠다.

## 수정

- 드롭 대상 카드에 `overlay-drop-target-pulse` 애니메이션을 추가해 대상이 살짝 위로 들리고 확대되도록 했다.
- 대상 카드 위·아래에 초록색 삽입 라인을 표시해 `before`/`after` 위치를 구분한다.
- `data-drop-position`을 DOM에 남겨 smoke 테스트가 실제 삽입 방향과 애니메이션 상태를 함께 확인하도록 했다.
- `prefers-reduced-motion`에서는 대상 카드 애니메이션을 끄고 삽입 라인과 강조 색상만 유지한다.

## 검증

- `pnpm build`: 통과
- `python scripts/widget-smoke.py`: 통과. 대상 카드의 `overlay-drop-target-pulse`, 삽입 방향, 드래그 중 캡처를 확인했다.
- 시각 QA: `test-artifacts/daybridge-schedule-overlay-drop-target.png`에서 고스트 카드, 상승한 대상 카드, 삽입 라인을 확인했다.
- 전체 Node 테스트·Cargo 점검은 커밋 전 새 코드 기준으로 재실행한다.

## 남은 확인

- 실제 Windows release 창에서 손으로 대상 카드를 가리킬 때 같은 모션이 보이는지 관찰한다.
