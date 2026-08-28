# 2026-08-28 Daybridge 브리지 자동 복구

## 관찰

- 다른 Codex 세션이 `%LOCALAPPDATA%\\Daybridge\\inbox\\schedule-2026-08-28.md`에 `SNL 상태 확인 화면 보강`을 `ready`, 50분 1단위로 정상 기록했다.
- 브리지가 중지된 동안 패키지 위젯의 native 로그에 `schedule_load_error`와 `Failed to fetch`가 반복됐다. 입력 파일 누락이나 파싱 오류가 아니었다.
- 로컬 브리지를 다시 실행한 뒤 `/api/schedule/inbox`는 `valid: true`, 해당 작업 1건을 반환했고 `/api/schedule`은 기존 루틴 2건과 새 세션 작업 1건을 반환했다.

## 조치

- Tauri 시작 시 `127.0.0.1:39393` 연결을 먼저 확인한다.
- 브리지가 없고 현재 체크아웃에 `scripts/local-bridge.mjs`가 있으면 Node를 콘솔 없이 실행한다.
- `bridge_autostart_spawned`, `bridge_autostart_ready`, 실패·타임아웃 이벤트를 native 로그에 남겨 위젯만 보이고 데이터 연결이 끊긴 상황을 구분한다.

## 검증 기준

- 브리지가 준비된 뒤 위젯 재기동 로그에 `schedule_load_success`와 `blocks: 3`이 기록되어야 한다.
- `/api/schedule/inbox?date=YYYY-MM-DD`에서 `valid: true`와 기대한 제목을 확인한다.
- Node 또는 스크립트를 찾지 못한 설치 환경은 자동 시작 실패 이벤트를 남기며, UI의 주기 재시도와 수동 새로고침으로 복구할 수 있다.
