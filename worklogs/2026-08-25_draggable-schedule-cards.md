# Daybridge 시간표 카드 드래그 재배치와 근무시간 제약

- 날짜: 2026-08-25 KST
- 범위: 카드 레이아웃 재구성, 근무시간·점심시간 슬롯 규칙, 카드 순서 이동 API, UI/릴리스 검증

## 결정

- 카드는 `상단: 시작 시각·미룸·완료`, `하단: 큰 작업명`의 2단 구조로 고정했다. 긴 작업명은 타이머나 조작 버튼을 침범하지 않고 두 줄까지 표시한다.
- 드래그 가능한 대상은 열린 focus 카드뿐이다. 완료·보류·건너뜀 focus와 캘린더 busy는 고정하며, 키보드에서는 위·아래 방향키로 같은 이동 명령을 보조한다.
- 작업 슬롯은 `HH:00–HH:50`만 사용한다. 기본 점심시간 `11:30–13:00`은 숨겨진 busy 제약으로 예약되어 `11:00`, `12:00` 작업이 생성되거나 이동되지 않는다. 화면에는 점심/여유 블록을 작업 카드로 노출하지 않는다.
- 이동은 `POST /api/schedule/block-move`가 검증·저장한다. 이동된 focus에는 `locked`와 `userPositioned`를 남기고, AIHUB에는 제목·시간·ID만 정제한 이동 receipt를 기록한다.

## 구현

- `src/schedule/scheduler.js`: 기본 점심 제약, stale lunch placement 마이그레이션, `getAvailableFocusSlots` 추가.
- `scripts/schedule-store.mjs`: 열린 focus 카드의 순서 이동·슬롯 재배치·고정 상태 저장.
- `scripts/local-bridge.mjs`: block-move endpoint와 sanitized event mirror 추가; 재생성 시 숨겨진 점심 블록 중복 보존 방지.
- `src/schedule/NowFocusOverlay.jsx`/CSS: 2단 카드, HTML5 drag/drop, drop target/dragging 상태, 키보드 순서 이동.
- `ScheduleSurface.jsx`와 대시보드: 이동 명령 연결, 숨겨진 점심/여유 블록 필터.

## 검증

- `node --test --test-reporter tap`: 52/52 통과.
- `python scripts/widget-smoke.py`: 카드 layout·실제 block-move 요청·순서 반영 스모크와 기존 dashboard/overlay 흐름 통과.
- `pnpm build`: 통과.
- `cargo fmt --manifest-path src-tauri\\Cargo.toml -- --check`: 통과.
- `cargo check --locked --manifest-path src-tauri\\Cargo.toml`: 통과.
- `pnpm tauri build`: release exe 및 NSIS installer 생성.
- live bridge health, release 위젯 재실행, 시작 프로그램 `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Daybridge`의 release 경로 확인.
- 시각 확인: `test-artifacts/daybridge-schedule-overlay-dragged.png`에서 상단 조작/하단 큰 작업명과 이동 후 카드 순서를 확인.

## 남은 확인

- 다중 모니터에서 드래그 후 점멸·자석 위치와 실제 Google Calendar busy 구간의 조합은 다음 실제 업무일에 관찰한다.
