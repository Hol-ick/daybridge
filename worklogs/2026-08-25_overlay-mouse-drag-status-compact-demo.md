# Daybridge 오버레이 입력 보강·테스트 일정 축약·카드 상태 순환

- 날짜: 2026-08-25 KST
- 범위: Tauri 오버레이 카드 이동 재현, 주입 일정 표시 품질, 하단 조작 행, 카드 상태 변경

## 원인 확인

- 기존 카드 이동은 pointer 이벤트만 직접 추적해 WebView에서 마우스 입력으로 전달되는 경로를 안정적으로 처리하지 못했다.
- 브리지의 레거시 후보 변환 경로가 긴 closeout 문장을 그대로 `scheduleTitle`로 넣어, 실제 오버레이에서 한 줄 제목이 지나치게 길어졌다.
- 카드 상태를 바꿀 전용 버튼을 제거한 뒤에도 카드 자체에 상태 변경 동작이 연결되지 않아, 목록에서 바로 조작할 수 없었다.

## 수정

- 카드와 오버레이 표면에 mouse/pointer 공통 문서 이동·해제 추적을 추가하고 6px 임계값 뒤에만 드래그를 시작한다. 이동 중 클릭은 억제하며, 완료·보류 카드와 점심/캘린더 블록은 계속 이동 대상에서 제외한다.
- `toScheduleTitle`을 브리지의 레거시 후보·보존 블록 경계에도 적용해 실제 일정에는 `배포 상태 확인`, `문서 검토`, `현재 맥락 확인`, `실패 로그 확인`, `번역 품질 검토`처럼 짧은 작업명을 사용한다. 원문과 상세는 보드 소스에 보존한다.
- 카드 전체 클릭과 Enter/Space 입력을 `미완료 → 진행 중 → 완료 → 보류 → 미완료` 순환으로 연결하고, 각 전환을 기존 상태 보고 endpoint로 즉시 저장한다.
- `작업 추가`를 목록 하단 footer에서 `재배치`·`전체 시간표`와 같은 행에 배치해 목록 상단을 비우고, 세 버튼 폭을 균등하게 유지했다.
- 회귀 fixture를 `메일 확인`, `리눅스 학습`, `내일 계획`으로 축약해 테스트 화면에서도 실제 사용 크기의 제목을 확인할 수 있게 했다.

## 검증

- `pnpm build`: 통과
- `python scripts/widget-smoke.py`: 통과. mouse drag fallback, 카드 순서 변경, 카드 상태 클릭·receipt, footer 버튼을 확인했다.
- `node --test --test-reporter tap`: 53/53 통과
- `node --test src/schedule/model.test.mjs`: 6/6 통과
- `node --test scripts/schedule-move.test.mjs`: 2/2 통과
- `cargo fmt --check`, `cargo check --locked`, `git diff --check`: 통과

## 남은 확인

- 새 release 실행 파일을 다시 빌드한 뒤 실제 Windows 위젯에서 planned 카드 드래그와 카드 클릭 상태 전환을 한 번 더 관찰한다.
