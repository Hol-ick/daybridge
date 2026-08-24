# 2026-08-24 — 로컬 디버깅 환경

## 목적

설치 프로그램을 반복 생성하지 않고 Daybridge의 UI와 local bridge를 빠르게 수정·확인할 수 있는 개발 흐름을 제공한다.

## 반영

- `pnpm dev:all`을 기본 개발 진입점으로 사용한다. Vite UI와 local bridge를 함께 실행한다.
- VS Code task에 일반 개발 환경, Node bridge inspector, 네이티브 위젯 개발 실행을 추가했다.
- VS Code launch에 UI 브라우저 디버그와 bridge Node inspector attach를 추가했다.
- 브라우저 디버그 프로필은 저장소에서 제외했다.
- 사용자 환경에 Node.js LTS와 사용자 전용 pnpm을 설치해 새 터미널에서 프로젝트 스크립트가 `node`를 찾도록 했다.
- Rust stable MSVC 도구체인과 Visual Studio Build Tools C++ 워크로드·Windows SDK를 설치했다.

## 운영 결정

- 일반 UI·데이터 흐름 확인은 `pnpm dev:all`만 사용한다.
- bridge에 breakpoint가 필요할 때만 `pnpm bridge:inspect`와 9229 attach를 사용한다.
- `pnpm build:widget`은 릴리스 후보용이며 일상 디버깅에서는 실행하지 않는다.
- native 위젯 확인은 `pnpm bridge`와 `pnpm dev:widget`의 두 프로세스로 구성한다. `dev:widget`은 Vite를 자체 실행하므로 `dev:all`과 동시에 실행하지 않는다.

## 검증 경계

- 의존성 lockfile 설치 상태와 Node.js LTS·pnpm 실행 경로를 확인했다.
- 기존 Vite UI가 실행 중이어서 중복 UI 서버를 시작하지 않았고, local bridge를 별도로 시작해 AIHUB handoff `connected` health 응답을 확인했다.
- Node 36개 테스트와 production web build가 통과했고 VS Code task/launch JSON도 파싱했다.
- `pnpm tauri info`에서 WebView2, MSVC, rustc, cargo, Rust toolchain을 확인했고 `src-tauri`의 `cargo check`가 통과했다.
- Tauri가 검사 중 생성하는 `src-tauri/gen/` schema 산출물은 로컬 생성물로 제외해 작업 트리를 깨끗하게 유지한다.
- Rust/Cargo 부재에 따른 네이티브 위젯 개발 모드는 별도 설치 후 확인 대상이다.
