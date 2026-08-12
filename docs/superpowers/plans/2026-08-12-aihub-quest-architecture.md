# AIHUB 퀘스트 추출·지속 구조 구현 계획

## 목표

상세 closeout을 원본 보고서로 유지하고, 별도 Quest Extractor가 사용자 실행 작업만 선별해 Daybridge Quest Plan으로 파생한다. Daybridge는 이 계획을 읽어 원자적 퀘스트, 명시적 순서, 여러 날에 걸친 동일 ID의 진행률을 보여주고, 사용자의 완료·보류·차단 영수증을 AIHUB에 되돌린다.

## 데이터 계약

- Mission: 여러 날에 걸친 목표의 집계 문맥. 직접 완료하는 단위가 아니다.
- Quest: 사용자가 10~30분 안에 하나의 관찰 가능한 결과를 만드는 실행 단위. `mission_id`, `priority`, `execution`, `depends_on`, `state`, `source_refs`를 가진다.
- Step: 퀘스트 내부의 기계적 체크리스트. 순차 실행이면 앞 단계 완료 전 잠근다.
- 상태: `ready`, `in_progress`, `deferred`, `blocked`, `completed`.
- `quest_id`와 `mission_id`는 날짜가 바뀌어도 유지한다. 미완료 퀘스트는 다음 계획에서 같은 ID로 carryover한다.
- AIHUB의 `actor=user`이고 실행 가능한 `kind`인 항목만 위젯으로 보낸다. 자동화 감시·Codex 작업·정책 판단은 `excluded`에 보존한다.
- XP·레벨·배지 없이 완료 단위/전체 단위 진행률과 다음 행동만 표시한다.

## 구현 순서

1. 타입과 컴파일러 테스트에 Quest Plan, Mission, carryover, dependency 계약을 추가한다.
2. AIHUB `conversation_bridge/daybridge_quest_extractor.py`를 추가해 상세 synthesis를 읽고 `_system/{date}_daybridge_quest_plan.json`과 Markdown 파생물을 원자적으로 생성한다. 고정 3개 제한을 제거하고 출처·품질·제외 이유를 보존한다.
3. Daybridge 컴파일러와 로컬 브리지를 Quest Plan 입력으로 전환한다. 이전 board/receipt와 ID를 병합해 carryover하고 `deferred`·`blocked`·순차 잠금 정보를 보존한다.
4. React 상태 모델과 todometer UI를 `Now / Next / Waiting / Completed` 중심으로 바꾼다. 카드 클릭 시 아래로만 확장하고, `내일 계속`과 잠금된 다음 단계를 컴팩트하게 조작한다.
5. 통합 계약·README·프로젝트 상태·worklog를 갱신한다. TypeScript, 컴파일러, AIHUB self-test, 브라우저 smoke를 실행한 뒤 `main`에서 커밋·푸시한다.

## 검증 기준

- 같은 `quest_id`가 날짜가 바뀌어도 유지되고 진행률·보류 횟수가 보존된다.
- 명시적 `depends_on`이 있는 퀘스트/step만 잠기며, 임의로 모든 작업을 순차화하지 않는다.
- actor/kind 필터가 시스템 작업을 위젯에서 제외하되 plan의 `excluded`에 남긴다.
- closeout에 실행 항목이 3개를 넘어도 모두 추출된다.
- UI에서 클릭 확장, step 완료, 보류, 완료, 새로고침 후 상태 보존이 브라우저에서 확인된다.
