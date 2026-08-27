# Daybridge 위젯 표시 복구

- 날짜: 2026-08-27 KST
- 범위: 위젯이 사라진 것으로 보이는 현상 원인 분석, 네이티브 가시성 복구, 릴리스 재기동

## 확인된 원인 범위

- `daybridge.exe`와 local bridge가 모두 실행 중이었고, bridge의 오늘 일정 응답은 `mode=todo`, `timeConfigured=false`, 2개 카드였다.
- native runtime log에는 `workday_auto_exit_triggered`, `app_exit_requested`, `window_destroyed` 또는 overlay `window_close_requested`가 없었다. 따라서 이번 관찰 시점에는 18:00 자동 종료나 프로세스 충돌로 보이지 않았다.
- Windows 창 검사는 overlay가 `visible`, `topmost`, `288x64`, 첫 번째 모니터 작업영역 우하단에 있음을 확인했다. 투명 WebView는 일반 화면 복사에서 누락될 수 있어 Win32 `PrintWindow`로 카드와 카운트다운 렌더링도 별도 확인했다.

## 결정 및 구현

- 네이티브 `ensure_overlay_visible` 경로를 추가해 숨김 해제·최상위 순서 재확인·표시를 한 번에 수행한다.
- 트레이 메뉴에 `위젯 다시 표시`를 추가했다. `Daybridge 열기`는 기존처럼 대시보드까지 열고, 새 메뉴는 위젯만 복구한다.
- 패키지 위젯은 15초마다 포커스를 훔치지 않고 표시 상태와 최상위 순서를 재확인한다. 실제 숨김에서 복구되면 `overlay_visibility_recovered`를 기록한다.
- overlay의 OS close 요청은 위젯이 지속되어야 하므로 숨기지 않고 `overlay_close_ignored`로 기록한다. 명시적인 `exit_app`/트레이 종료는 기존대로 프로세스를 종료한다.
- `docs/DEBUGGING.md`에 복구 메뉴와 지속 위젯 동작을 반영했다.

## 검증

- `pnpm build`: 성공.
- `pnpm test:compiler`: 8개 테스트 전부 통과.
- `cargo fmt`, `cargo check`, `cargo test`: 성공. native unit test는 대상 없음(0개).
- `pnpm build:widget`: 릴리스 실행 파일과 NSIS 설치 파일 생성 성공.
- 새 릴리스 프로세스가 응답 중이며 창은 `visible=true`, `topmost=true`, `288x64`, `x=1632,y=976`으로 확인했다.
- bridge `GET /api/schedule?date=2026-08-27`: 정상 응답, `todo` 모드·무시간 설정·2개 블록·`todo_list` 상태.
- 실제 `WM_CLOSE`를 overlay에 보내도 2초 뒤 창이 계속 visible이고, native log에 `window_close_requested`와 `overlay_close_ignored`가 남았다.

## 남은 확인

- 현재 모니터 구성과 사용자가 실제로 바라보는 화면이 다를 때의 체감 위치는 현장에서 한 번 더 확인한다. 저장 위치는 첫 번째 모니터 작업영역 우하단이다.
- OAuth client 미설정으로 Google Calendar coverage는 `attention`이며, 일정 표시와 별개인 기존 연결 상태다.
