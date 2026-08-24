# 2026-08-24 — 오버레이 위치 고정 원인 수정

## 현상

- 오버레이를 옮겨도 다시 실행하거나 WebView가 다시 마운트되면 우하단으로 돌아왔다.
- 일부 Windows/WebView2 포커스 상태에서는 카드에서 드래그를 시작해도 창이 움직이지 않는 것처럼 보였다.

## 원인

- 위치의 주 저장소가 WebView `localStorage`뿐이어서 네이티브 창 재실행 시 신뢰할 수 없었다.
- `placeOverlayInCorner`가 마운트 때마다 임시 저장값을 읽고 기본 우하단 좌표를 다시 적용할 수 있었다.
- `startDragging()` 호출이 최초 pointerdown이 아니라 이동 임계값을 넘은 뒤 비동기로 실행되어 Windows 네이티브 드래그 시작 조건과 어긋났다.

## 수정

- Tauri Rust의 overlay `Moved` 이벤트에서 임의의 창 좌표를 앱 데이터의 `overlay-position.json`에 저장한다.
- `get_overlay_position`/`save_overlay_position` 명령을 추가하고, 시작 시 저장 좌표를 현재 모니터 작업 영역 안으로 보정해 복원한다.
- 모서리 자석으로 보정된 좌표도 네이티브 저장소에 즉시 기록한다.
- 최초 pointerdown에서 `startDragging()`을 호출하고, 이동이 감지된 경우에만 제목 버튼 클릭을 억제한다.
- 네이티브 창 폭과 카드 폭이 달라 보이던 16px 오른쪽 빈 영역은 overlay의 `100vw - 16px` 제한을 제거해 252px로 맞췄다.
- 제목 버튼의 클릭을 native drag가 가로채던 회귀를 분리했다. 버튼은 일반 클릭으로 관리 화면을 열고, 실제 이동이 감지된 경우에만 드래그를 시작한다. 카드 배경은 즉시 드래그할 수 있다.
- 오버레이 메타 줄에 로컬 시간 기준 `18:00까지 n시간 n분`을 추가하고 30초마다 갱신한다. 18시 이후에는 `퇴근 시간 지남`을 표시한다.

## 검증

- `cargo check --manifest-path src-tauri/Cargo.toml` 통과.
- compiler·schedule·calendar Node 테스트 총 20개 통과.
- TypeScript 검사, Vite production build, `python scripts/widget-smoke.py` 통과.
- 실제 Windows 창을 `1098,548`로 옮긴 뒤 프로세스를 재기동해 같은 좌표로 복원되는 것을 확인했다.
- 실제 마우스 드래그로 창이 `1218,668`로 이동하고 같은 좌표가 네이티브 저장 파일에 기록되는 것을 확인했다.
- 252×52 viewport에서 카드 폭·높이와 퇴근 카운트다운 DOM을 확인하고, 제목 클릭 smoke와 완료 보고 smoke를 통과했다.

## 남은 확인

- 사용자의 실제 다중 모니터 구성에서 모니터를 바꾼 뒤 저장 좌표가 새 작업 영역 안으로 보정되는지 관찰한다.
