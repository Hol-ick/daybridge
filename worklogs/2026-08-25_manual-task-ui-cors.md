# Daybridge 수동 작업 무반응·오버레이 UI 개선

- 날짜: 2026-08-25 KST
- 범위: release 위젯의 수동 작업 저장, 오버레이 확장/접힘, 입력 UI 시각 개선

## 현상과 원인

- 브라우저 smoke는 브리지 mock을 사용해 통과했지만 release Tauri에서 `배치`가 무반응처럼 보였다.
- 실제 요청 origin은 `http://tauri.localhost`인데 브리지 CORS 허용 목록은 개발 포트만 포함했다. 응답의 허용 origin이 개발 기본값으로 돌아가 WebView가 POST 응답을 차단했다.
- 오버레이 surface에는 오류 notice를 그리지 않아 실패가 사용자에게 표시되지 않았다.

## 수정

- `http://tauri.localhost`, `https://tauri.localhost`, `tauri://localhost` 및 포트가 붙은 Tauri origin을 CORS 허용 목록에 추가했다.
- 브리지 테스트에 Tauri origin의 `Access-Control-Allow-Origin` 계약을 추가했다.
- 수동 입력 폼에 inline 오류·`aria-live` 피드백, 명확한 placeholder·name·autocomplete·focus-visible을 추가했다.
- 확장 패널의 `오늘 일정 0/0` 헤더를 제거하고, 외부 pointerdown과 native window blur에서 최소 상태로 접히게 했다.
- 빈 상태를 상단의 점선 안내 카드로 옮기고, 입력·시간 선택·배치 버튼 대비를 높였다.

## Tailwind 판단

- 현재 저장소에는 Tailwind 의존성·설정·plugin이 없다.
- Vite/Tauri에서 도입은 가능하지만 기존 UI가 CSS Modules 중심이고 위젯 규모가 작아, 이번 변경에 Tailwind를 부분 도입하면 두 스타일 체계가 섞인다. 이번에는 CSS Modules 토큰을 정리했고, 전면 마이그레이션은 별도 작업으로 남겼다.

## 검증

- CORS 실패 테스트를 먼저 확인한 뒤 수정 후 통과
- `pnpm build` 통과
- Node 테스트 49/49 통과
- `python scripts/widget-smoke.py` 통과: 외부 클릭 자동 접힘·입력 폼 캡처 포함
- `cargo fmt --manifest-path src-tauri\\Cargo.toml -- --check` 통과
- `cargo check --locked --manifest-path src-tauri\\Cargo.toml` 통과
- live bridge health 및 `Origin: http://tauri.localhost` 응답 header 확인
- release 실행 파일·NSIS 설치 프로그램 재빌드 및 위젯 재실행
- 시각 확인: `test-artifacts/daybridge-schedule-overlay-manual-form.png`
