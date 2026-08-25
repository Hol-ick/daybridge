# Daybridge 포인터 드래그·한 줄 작업명·오버레이 조작 축소

- 날짜: 2026-08-25 KST
- 범위: Tauri 오버레이 카드 드래그 재현, 긴 제목 클리핑 수정, 확장 패널 조작 축소

## 원인 확인

- 기존 카드는 HTML5 `draggable`/`dragstart`에만 의존해 실제 Tauri WebView 마우스 이동에서 드래그 시작이 안정적이지 않았다.
- 긴 제목을 가진 flex/grid 카드가 자식의 최소 콘텐츠 너비를 전파해 카드가 목록 폭 266px을 넘어 약 495px까지 늘어났다. 그 결과 제목이 잘리고 marquee 측정도 정상 동작하지 않았다.
- 확장 패널 상단에 접기 버튼과 카드별 미룸·완료 조작이 남아 있었고, 작업 추가 버튼도 상단에 배치되어 있었다.

## 수정

- 카드 pointerdown/move/up을 직접 추적하고, 6px 이상 이동했을 때 drop target을 좌표로 계산해 `/api/schedule/block-move`로 보낸다. 방향키 이동은 유지한다.
- 카드와 제목에 `width:100%`, `min-width:0`, `max-width:100%`, `overflow:hidden`을 적용해 목록 폭을 지키고, 제목은 한 줄 `OverlayTitle` marquee로 표시한다.
- grid 목록에 `align-content:start`를 적용해 카드가 남은 높이를 불필요하게 늘리지 않도록 했다.
- 확장 패널 상단 접기 버튼과 오버레이 카드의 미룸·완료 버튼을 제거했다. 요약 행은 계속 클릭해 열고 닫을 수 있으며, `작업 추가`는 하단 작은 컨트롤로 이동했다.

## 검증

- 긴 제목 smoke에서 카드 폭이 목록 폭 안에 있고, `white-space: nowrap`, marquee animation, 제거된 버튼 부재를 확인.
- 포인터 이벤트 smoke에서 세 카드 중 첫 카드를 두 번째 카드 위로 옮긴 뒤 실제 move 요청과 화면 순서 변경을 확인.
- `pnpm build`: 통과.
- `python scripts/widget-smoke.py`: 통과.
- `node --test --test-reporter tap`: 53/53 통과.
- 시각 QA: `test-artifacts/daybridge-schedule-overlay-dragged.png`에서 한 줄 제목·하단 작업 추가·버튼 제거·compact 카드 높이를 확인.

## 남은 확인

- 새 release 패키지를 다시 설치한 뒤 실제 Tauri 창에서 포인터 드래그와 marquee가 동일하게 보이는지 확인한다.
