# 2026-08-27 — 시간 미설정 시 오늘 할 일 목록 모드

## 요청

시간 설정을 아직 하지 않은 사용자는 임의의 근무시간·점심시간을 받지 않고,
오늘 해야 할 일을 가벼운 목록으로 사용할 수 있어야 한다.

## 결정

- 새 설정의 `dayStart`·`dayEnd` 기본값은 빈 문자열이다.
- `timeConfigured=false`이면 스케줄러가 시간·점심·카운트다운을 만들지 않고
  무시간 `mode=todo` focus 목록을 생성한다.
- 목록 항목은 기존 상태 보고 API를 재사용해 완료·진행·보류를 기록한다.
- 시간 입력을 모두 비우고 저장하면 목록 모드로 전환한다.
- 이전 버전이 암묵적으로 저장한 `09:00–18:00` 설정은 미설정으로 마이그레이션한다.
- 시작·마감 중 하나만 입력된 경우에도 안전하게 미설정으로 정규화한다.
- 기존 시간표가 남아 있더라도 저장 설정과 모드가 다르면 다음 조회에서 자동 재생성한다.
- 목록 모드에서는 시간표 드래그 이동과 18:00 자동 종료를 사용하지 않는다.

## 변경 범위

- `scripts/schedule-store.mjs`: 빈 시간 설정과 레거시 기본값 마이그레이션
- `src/schedule/scheduler.js`: 무시간 todo 스케줄, `todo_list` focus 상태
- `src/schedule/model.js`: 무시간 focus 블록 정규화
- `scripts/local-bridge.mjs`: 설정 모드 변경 감지와 목록 재생성
- `ScheduleSurface.jsx`, `NowFocusOverlay.jsx`, `ScheduleDashboard.jsx`: 목록형 표시,
  빈 시간 입력, 목록 모드에서 카운트다운·시간 이동 비활성화

## 검증 기준

- 시간 미설정 스케줄의 항목에 `startAt`·`endAt`가 없음
- `resolveNowFocus()`가 `todo_list`를 반환함
- 시간 미설정 상태에서 사용 가능한 시간 슬롯이 없음
- 수동 작업·inbox 작업이 목록 항목으로 표시됨
- 시간 설정이 명시되면 기존 HH:00–HH:50 배치가 유지됨
- 전체 Node 테스트, TypeScript/Vite 빌드, Tauri 패키지 빌드가 통과함
