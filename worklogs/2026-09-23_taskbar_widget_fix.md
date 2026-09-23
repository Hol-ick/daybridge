# 2026-09-23 위젯 작업 표시줄 표시 보정

- 상태: 수정 반영·Windows release 빌드·재시작 및 창 닫기 동작 검증 완료

## 현상

Windows 시작 프로그램으로 Daybridge가 실행될 때 위젯이 작업 표시줄 앱 창으로 표시되었다. 사용자가 원하는 상태는 tray와 위젯만 유지되고 작업 표시줄에는 앱 창이 나타나지 않는 상태다.

## 원인

- `src-tauri/tauri.conf.json`의 overlay 창에는 `skipTaskbar: true`가 있었지만, 실행 중인 overlay HWND의 실제 확장 스타일은 `WS_EX_APPWINDOW`가 켜지고 `WS_EX_TOOLWINDOW`가 꺼진 `0x40018`이었다.
- 관리용 dashboard 창에는 `skipTaskbar` 설정이 없었다.
- 따라서 설정 선언만으로 Windows 네이티브 창 스타일이 항상 작업 표시줄 제외 상태를 보장하지 못했다.

## 수정

- overlay와 dashboard 모두 `skipTaskbar: true`를 명시했다.
- Windows 실행 시 overlay HWND에서 `WS_EX_APPWINDOW`를 제거하고 `WS_EX_TOOLWINDOW`를 추가하는 `apply_overlay_taskbar_style`을 추가했다.
- 위젯 표시·복구 경로에서 해당 스타일을 다시 적용하도록 연결했다.
- 네이티브 taskbar 스타일 조건을 `scripts/native-overlay-bounds.test.mjs`에 회귀 테스트로 추가했다.

## 검증

- 회귀 테스트: 5/5 통과
- compiler tests: 8/8 통과
- TypeScript check: 통과
- production web build: 통과
- `git diff --check`: 통과
- 현재 실행 창의 실제 스타일을 읽기 전용 확인: 적용 전 `0x40018` → 적용 후 `0x98`; `WS_EX_TOOLWINDOW=true`, `WS_EX_APPWINDOW=false`
- 현재 실행 중인 창에는 직접 스타일 보정을 적용했으며, 위젯과 local bridge는 강제 종료하지 않았다.

## 미완료 경계

- 현재 컴퓨터에 Rust/Cargo 툴체인이 없어 `cargo check`와 새 Tauri release build는 수행하지 못했다.
- 현재 시작 프로그램이 가리키는 release EXE는 기존 빌드이므로, 다음 로그인 후에도 영구적으로 적용하려면 Rust/Cargo 설치 후 native build와 재기동 검증이 필요하다.
- 전체 Node 테스트 병렬 실행에는 기존 일정 endpoint 및 geometry 기대값 실패가 있었으나 taskbar 변경과 무관하다. taskbar 관련 테스트는 독립적으로 통과했다.

## 2026-09-23 사용자 화면 정정 및 후속 수정

- 첨부 화면에서 사용자가 가리킨 대상은 Daybridge의 초록색 작업 표시줄 아이콘이다.
- 실행 중인 overlay HWND는 이미 `WS_EX_TOOLWINDOW`가 켜지고 `WS_EX_APPWINDOW`가 꺼진 `0x98`이었다. 동적으로 생성된 숨김 dashboard HWND는 반대로 `0x40110`이어서 작업 표시줄 표시 스타일을 유지하고 있었다.
- dashboard를 생성할 때와 표시할 때 작업 표시줄 제외 스타일을 적용하도록 수정했다. 현재 실행 중인 dashboard HWND에도 임시 적용하여 `0x40110`에서 `0x190`으로 바뀌었고, `WS_EX_APPWINDOW=false`, `WS_EX_TOOLWINDOW=true`를 읽어 확인했다.
- overlay 닫기 요청이 무시되고 창을 다시 표시하던 동작을 바꿨다. overlay/dashboard 창 닫기는 명시적 종료 표식을 기록한 뒤 앱 종료를 요청하므로 외부 프로세스 감시자가 재실행하지 않아야 한다. tray의 `숨기기`와 `종료` 메뉴는 유지한다.
- 현재 실행 중인 EXE는 소스보다 오래된 바이너리다. `cargo`와 `rustc`를 찾지 못해 수정 소스를 새 실행 파일로 빌드하지 못했으므로, 창 닫기 동작의 재기동 검증은 미완료다.

## 적용 및 재시작 확인

- Rustup 1.29.1과 Visual Studio 2022 C++ 빌드 도구를 준비했다.
- `pnpm run build:widget` 성공: TypeScript/Vite 빌드와 Windows Tauri release/NSIS 패키징 완료.
- 수정한 release EXE를 실행한 뒤 네이티브 창 상태를 다시 확인했다. 위젯은 `0x98`, 숨김 dashboard는 `0x190`; 두 창 모두 `WS_EX_APPWINDOW=false`, `WS_EX_TOOLWINDOW=true`다.
- 새 빌드 overlay에 `WM_CLOSE` 종료 요청을 보내 프로세스 종료와 `window_close_requested_exit`, `process_watchdog_stopped` 기록을 확인했다. 이후 release EXE를 다시 실행해 현재 위젯을 복구했다.
- 최종 재실행 상태: Daybridge 프로세스 정상 응답, 시작 프로그램 값은 release EXE 경로, 명시적 종료 표식은 제거됨, `/api/health`는 `ok`.
- `git diff --check` 성공. 추가 테스트 명령은 실행하지 않았다.

## 다음 행동

Rust/Cargo 설치 승인 후 `pnpm build:widget` 또는 동등한 native build를 수행하고, 시작 프로그램 경로의 EXE를 새 빌드로 확인한 다음 재기동 후 HWND 스타일과 작업 표시줄 표시 여부를 다시 검증한다.
