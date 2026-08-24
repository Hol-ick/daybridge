# Daybridge Windows 시작 프로그램 등록

- 날짜: 2026-08-24 KST
- 범위: 배포용 Tauri 실행 파일의 Windows 로그인 후 자동 실행

## 결정

- 개발 빌드는 로컬 Vite 서버에 의존하므로 시작 프로그램에 등록하지 않는다.
- 배포 빌드는 실행될 때 현재 실행 파일의 절대 경로를 사용자 계정의 `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` 아래 `Daybridge` 값으로 저장한다.
- 관리자 권한이 필요 없는 현재 사용자 범위의 등록만 사용한다.

## 구현

- `src-tauri/src/main.rs`에 Windows 레지스트리 등록을 추가했다.
- `winreg`는 Windows 대상 의존성으로만 추가했다.
- `cfg!(debug_assertions)`로 개발 실행 파일이 시작 항목을 덮어쓰지 않게 했다.

## 검증

- `cargo check --manifest-path src-tauri/Cargo.toml` 통과.
- 배포 실행 파일 `src-tauri/target/release/daybridge.exe` 생성 확인.
- 배포 실행 파일을 실행한 뒤 다음 시작 항목을 읽어 실제 경로 등록을 확인했다.
  - 값 이름: `Daybridge`
  - 값: 배포용 `daybridge.exe` 절대 경로
- 테스트용 배포 프로세스는 종료했고, 기존 개발 프로세스는 건드리지 않았다.

## 참고

- `pnpm tauri build`의 NSIS 설치 패키지 단계는 NSIS 다운로드·추출 과정에서 Windows 액세스 거부로 종료됐지만, 자동 시작에 필요한 배포 실행 파일 빌드와 레지스트리 등록 검증은 완료했다.
