# Daybridge 수동 작업 추가·50분 단위 배치

- 날짜: 2026-08-25 KST
- 범위: 오버레이·대시보드 수동 작업 입력, 보드 저장, 시간표 자동 분할

## 요청

- 빈 시간표에서 사용자가 할 일을 직접 추가할 수 있어야 한다.
- 긴 작업은 시간 단위로 쪼개어 시간표에 배치되어야 한다.

## 구현

- `POST /api/quests/manual`을 추가했다. 제목과 `50·100·150분`만 허용하고, 수동 퀘스트를 현재 날짜 보드에 atomic write한다.
- 수동 퀘스트에는 `sourceLabel: 수동 추가`, `sourcePath: manual://widget`, `ready` 상태와 1개의 완료 receipt step을 기록한다. 추가 이벤트는 민감정보를 제거한 형태로 로컬 이벤트와 AIHUB handoff sink에 미러링한다.
- 기존 스케줄러의 고정 `HH:00–HH:50` 단위를 이용해 100분 작업은 두 블록, 150분 작업은 세 블록으로 분할한다. 기존 busy·완료·잠금 블록은 유지한다.
- 전체 시간표의 `작업 추가`와 오버레이 확장 패널의 `＋ 작업 추가`에 공통 입력 폼을 연결했다. 저장 중 중복 제출을 막고, 성공하면 폼을 닫고 즉시 새 시간표를 보여준다.

## 검증

- `pnpm build` 통과
- `node --test --test-reporter tap` 통과 (49/49)
- `python scripts/widget-smoke.py` 통과: 대시보드 수동 작업 100분 POST, 저장 알림, 폼 닫힘 확인
- `cargo fmt --manifest-path src-tauri\\Cargo.toml -- --check` 통과
- `cargo check --locked --manifest-path src-tauri\\Cargo.toml` 통과
- `git diff --check` 통과

## 남은 확인

- 실제 사용 중인 AIHUB 보드에서 브리핑 작업과 수동 작업이 섞일 때 우선순위가 의도대로 보이는지 다음 일정 생성에서 관찰한다.
- Google Calendar OAuth가 연결되면 busy 블록이 추가된 상태에서 50분 단위 분할이 비어 있는 시간만 사용하는지 확인한다.
