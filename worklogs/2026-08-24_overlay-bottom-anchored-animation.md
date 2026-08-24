# Daybridge 오버레이 하단 고정 확장 애니메이션

- 날짜: 2026-08-24 KST
- 범위: 288px 오버레이의 열림·닫힘 전환

## 문제

- 네이티브 창 높이를 먼저 키운 상태에서 카드가 창 위쪽에 남아 CSS 확장을 시작했다.
- 그 결과 사용자가 기대한 "아래에 박힌 카드의 상단이 위로 늘어나는" 흐름과 달리 카드가 이동하거나 방향이 뒤섞여 보였다.

## 구현

- overlay 호스트를 네이티브 창 전체 높이로 만들고, 카드 surface를 flex 하단에 고정했다.
- 열림: `resizeOverlay(520)` 완료 후 `surface` 높이를 `64px→520px`로 애니메이션한다.
- 닫힘: `surface`를 `520px→64px`로 280ms 접은 뒤 `resizeOverlay(64)`를 실행한다.
- 요약 행은 항상 surface 하단에 absolute 배치하고, 확장 패널은 그 위에서 하단 transform 기준으로 펼친다.
- 브라우저 스모크에서 열림·닫힘 중간 프레임 캡처와 요약 행·surface 하단 정렬을 검사한다.

## 시각 QA

- 열림 중간 캡처: `test-artifacts/daybridge-schedule-overlay-animation-mid.png`
- 닫힘 중간 캡처: `test-artifacts/daybridge-schedule-overlay-animation-close-mid.png`
- 두 캡처 모두 카드 하단은 고정되고 상단만 변한다.
