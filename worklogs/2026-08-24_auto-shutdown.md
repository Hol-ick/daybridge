# Daybridge 퇴근 후 자동 종료

- 날짜: 2026-08-24 KST
- 범위: 18:00 이후 Daybridge 프로세스 종료

## 결정

- 종료 기준은 운영체제의 로컬 시각 `18:00`이다.
- 18:00 전에 실행된 앱은 해당 시각에 종료한다.
- 18:00 이후 실행된 배포본은 시작 직후 종료한다.
- 종료는 overlay webview에서 감시하되, Tauri `AppHandle::exit(0)`로 dashboard와 tray를 포함한 전체 프로세스를 끝낸다.
- 브라우저 미리보기에서는 앱을 종료하지 않는다.

## 구현

- Rust에 `exit_app` Tauri command를 추가했다.
- 배포용 `ScheduleSurface`의 overlay 전용 effect가 30초 이하 간격으로 18:00을 확인하고, 경계 시각에는 즉시 명령을 호출한다. Vite 개발 모드에서는 자동 종료를 비활성화한다.
- 컴퓨터가 절전에서 깨어나거나 시계가 변경돼도 다음 확인에서 현재 시각을 다시 계산한다.

## 검증

- `getWorkdayCountdown` 경계 단위 테스트로 18:00 이후 상태를 확인한다.
- TypeScript·Vite build, Node 테스트, widget smoke, Rust check, diff 검사를 실행한다.
- 실제 시스템 시각을 18:00으로 변경하는 검증은 하지 않는다. 종료 명령은 Tauri 등록과 정적 호출 경로까지 확인한다.
