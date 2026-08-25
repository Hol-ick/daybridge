# AIHUB 일정 입력 계약과 50분 슬롯 정규화

- 날짜: 2026-08-25 KST
- 범위: AIHUB Quest Plan 수신 경계, 검증·정규화, 스케줄 배치 규칙

## 검토 결과

- AIHUB Quest Plan → compiler → local bridge → `toTaskCandidate` → 50분 스케줄러로 이어지는 경로를 대조했다.
- 기존 입력은 `estimate_minutes`를 작업 분량으로 받지만 실제 스케줄러는 모든 focus block을 `HH:00–HH:50`으로 만들고 있어, 입력 분량과 실제 배치 단위가 분리돼 있었다.
- legacy closeout의 `confirmation_questions`가 자동 `decision` Quest로 바뀔 수 있었다.
- Quest에 고정 시각을 전달하는 정식 경로가 없으므로, 캘린더 busy block과 작업 후보를 섞으면 잘못된 시간표를 만들 수 있었다.

## 결정

- 새 입력 포맷은 `daybridge_quest_plan` 1.1로 정립했다.
- 스케줄링 분량의 정본은 양의 정수 `focus_units`와 `remaining_units`이며, 한 단위는 50분이다.
- `source_date`와 `schedule_date`를 분리한다. 기존 `activity_date`는 source date 호환 별칭이다.
- Quest의 `start_at`/`end_at`은 금지한다. 회의·약속·점심시간은 Calendar busy range 또는 Daybridge 설정으로만 전달한다.
- 확인 질문은 `review_queue`, 자동화·Codex·정책 작업은 `excluded`로 보존하고 실행 큐에 넣지 않는다.
- 기존 1.0 포맷은 깨지지 않도록 `estimate_minutes`를 50분 단위로 올림 변환한다. 새 1.1 산출물은 `focus_units`를 반드시 명시한다.

## 구현

- `src/schedule/input-contract.js`에 artifact/version/date/status/actor/kind/state/단위/고정시각/보안 경계를 검사하는 `validateQuestPlan`을 추가했다.
- compiler가 검증 결과의 `accepted`만 board Quest로 만들고, `reviewQueue`와 `excluded`를 board 메타데이터에 보존한다.
- compiler와 local bridge/model이 `focus_units`·`remaining_units`를 각각 `estimateMinutes`·`remainingMinutes`로 변환한다.
- closeout fallback에서 `confirmation_questions`를 자동 퀘스트로 만들지 않고 review queue로 이동했다.
- `docs/INTEGRATION_CONTRACT.md`에 정식 JSON 예시, 필드 규칙, 배치·검증·금지 규칙을 기록하고 `docs/ARCHITECTURE.md`, `docs/DEBUGGING.md`, `README.md`에 경계를 연결했다.

## 검증

- `node --test` 통과: 전체 62개.
- `node scripts/compile-quests.mjs --self-test` 통과.
- `pnpm build` 통과.
- `git diff --check` 통과.

## 남은 확인

- 실제 다음 AIHUB closeout이 `schema_version=1.1`, `focus_units`, `source_date/schedule_date`를 생성하는지 첫 실데이터에서 확인해야 한다.
- `reviewQueue`를 위젯에서 별도 확인할 UI는 아직 계약 메타데이터만 보존한다. 자동 실행하지 않는 현재 동작이 우선이다.
