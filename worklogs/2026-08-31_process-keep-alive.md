# Daybridge 위젯 프로세스 재기동 감시

- 증상: 화면에서 사라진 시점에 release `daybridge.exe` 프로세스와 local bridge 포트가 모두 내려가 있었다. 마지막 런타임 이벤트는 정상 일정 로딩이었으며 `app_exit_requested`·`tray_quit_requested`·Daybridge 충돌 보고서는 확인되지 않았다.
- 원인 경계: 기존 감시는 살아 있는 Tauri 프로세스에서 창만 다시 보이게 할 뿐, 프로세스 자체가 사라진 뒤에는 다시 실행할 주체가 없었다. 프로세스가 왜 종료됐는지는 해당 관찰만으로 확인되지 않았다.
- 변경: 릴리스 앱이 사용자 데이터 영역에 독립 PowerShell 감시자를 시작한다. 이 감시자는 3초마다 release 실행 파일을 확인하고, 프로세스가 없으면 재기동한다. 트레이 종료와 `exit_app`은 명시적 종료 표식을 먼저 만들어 감시자를 중지한다.
- 진단: `runtime-events.ndjson`에 `process_watchdog_started`, `process_relaunch_requested`, `process_relaunch_error`를 남긴다.
- 검증: Rust 단위 테스트 3건, `pnpm test:compiler` 8건, release 빌드 성공. 실행 중인 release 프로세스를 종료한 뒤 감시자가 새 프로세스를 기동했고, bridge health는 `ok / connected`로 유지됐다.
