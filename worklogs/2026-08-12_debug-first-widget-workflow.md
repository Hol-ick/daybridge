# 2026-08-12 — 디버깅 우선 위젯 실행 흐름

## 결정

- 기능 개발과 UI 디버깅은 `pnpm dev` 브라우저 미리보기를 기본으로 사용한다.
- AIHUB 상태 기록이 필요한 경우에만 별도 터미널에서 `pnpm bridge`를 실행한다.
- `pnpm dev:widget`은 Rust/MSVC/WebView2가 준비된 환경에서 네이티브 창을 확인할 때 선택적으로 사용한다.
- `pnpm build:widget`은 릴리스 설치 파일을 만들 때만 실행한다.

## 확인

- 브라우저 위젯에서 축소 카드, 아래 방향 확장, 서브 퀘스트 완료 흐름을 확인했다.
- `pnpm check`, `pnpm build`, `pnpm test:compiler`를 다시 실행해 개발 경로의 회귀를 확인했다.
- 현재 컴퓨터에서는 Rust/Cargo가 없어 네이티브 Tauri 실행과 패키징은 별도 환경 준비가 필요하다.
