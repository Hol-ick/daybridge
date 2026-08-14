# 다른 세션 전달용 지시서 — AIHUB → Daybridge 퀘스트 정제

> 이 문서는 다음 세션이 바로 실행할 수 있는 작업 지시서다. 기획안의 원칙을 구현 단계로 압축했다.

## 최종 목표

AIHUB closeout을 읽어 **사용자가 오늘 실제로 수행할 수 있는 카드만** Daybridge에 만든다.

이번 작업의 완료 상태는 “보드가 생성됨”이 아니라 다음 문장으로 판단한다.

> 8/13 closeout의 내일 첫 행동이 누락 없이 검증되고, 각 카드가 동사형·원자적·안전한 상태로 표시되며, coverage 불완전성과 테스트 데이터가 사용자에게 섞이지 않는다.

## 먼저 읽을 파일

1. `docs/superpowers/plans/2026-08-14-aihub-daybridge-quest-quality.md`
2. `scripts/compile-quests.mjs`
3. AIHUB `AIHUB:/04_Operations_And_Automation/Memory_System/conversation_bridge/daybridge_quest_extractor.py`
4. AIHUB `AIHUB:/04_Operations_And_Automation/Memory_System/reports/daily/2026-08-13.md`
5. AIHUB `AIHUB:/04_Operations_And_Automation/Memory_System/reports/daily/_system/2026-08-13_unified.json`
6. AIHUB `AIHUB:/04_Operations_And_Automation/Memory_System/reports/daily/_system/2026-08-13_daybridge_quest_plan.json`
7. AIHUB `AIHUB:/04_Operations_And_Automation/Memory_System/reports/daily/_system/2026-08-13_daybridge_board.json`
8. AIHUB `AIHUB:/04_Operations_And_Automation/Memory_System/reports/daily/_system/latest_daybridge_handoff.json`

## 반드시 고칠 것

### 1. 명시적 내일 첫 행동 보존

- 입력 우선순위는 `tomorrow_first_steps` → `open_items` → `confirmation_questions` 순서로 고정한다.
- `tomorrow_first_steps`의 각 항목은 후보 생성·제외 판정 중 하나를 반드시 거친다.
- 제외할 때는 제목과 이유를 `excluded`에 남긴다.
- 8/13 기준으로 `list_threads` 재시도 항목이 사라지지 않는지 회귀 테스트를 추가한다.

### 2. 문장 정규화

- 관찰/위험 서술을 실행 동사형 제목으로 바꾼다.
- 원본 `summary`와 `source_refs`는 보존하되, 사용자 카드 `title`, `firstStep`, `currentAction`은 짧게 만든다.
- 원본 문장에 절대 경로가 있으면 공유 기록에는 논리 alias 또는 안전한 설명만 남긴다.
- `[local path]`가 첫 행동이나 제목에 남으면 사용자 카드 생성을 거부한다.

### 3. 순차 작업 분해

- 한 카드가 “확인 → 조치 → 재확인”을 포함하면 `execution=sequential`로 만든다.
- 단계마다 `dependsOn`을 실제 이전 단계 ID로 연결한다.
- 단순한 한 번의 확인은 억지로 서브퀘스트를 만들지 않는다.
- 단계는 사용자가 완료 체크할 수 있는 결과 단위여야 한다.

### 4. coverage·shutdown 경계 전달

- unified의 `coverage.conversation.today_scope/all_history_scope`가 `unavailable`이면 board에 경고를 추가한다.
- shutdown/session archive가 blocked이면 “전체 세션 반영 완료”로 표시하지 않는다.
- `record_quality=aligned`와 coverage 완전성을 같은 값으로 취급하지 않는다.

### 5. 합성·미래 handoff 차단

- `activity_date`가 현재 보드 기준일보다 미래인 handoff는 사용하지 않는다.
- `test complete report`, `2099-*`, synthetic fixture는 `excluded` 또는 quarantine으로 보낸다.
- `latest_daybridge_handoff.json`만 보고 현재 업무 완료를 복원하지 않는다.

## 권장 구현 순서

- [ ] **1단계 — 회귀 fixture 작성**
  - 8/13 closeout의 세 내일 첫 행동, coverage unavailable, shutdown blocked, 2099 테스트 handoff를 최소 fixture로 만든다.
  - 먼저 테스트가 실패하는지 확인한다.

- [ ] **2단계 — extractor 경계 수정**
  - `tomorrow_first_steps` 누락을 막는다.
  - 내부 운영 기록과 사용자 업무를 구분한다.
  - 확인 질문은 자동 실행 퀘스트로 만들지 않는다.

- [ ] **3단계 — 문장 정규화기 추가/수정**
  - 상황 설명 → 동사형 제목/첫 행동 변환
  - `[local path]` 및 절대 경로 노출 차단
  - source 원문·근거 보존

- [ ] **4단계 — 순차 단계 생성**
  - 프로세스 경로 검증과 배포 asset 검증을 단계 배열로 변환
  - 독립 작업에는 단일 단계만 유지

- [ ] **5단계 — 보드 품질 메타데이터 전달**
  - `sourceCoverage=attention` 또는 동등한 경고를 coverage 불완전 시 기록
  - `sourceWarnings`에 대화 coverage/shutdown/test handoff 경고 추가

- [ ] **6단계 — UI 상태 검증**
  - ready 카드: 제목·첫 단계·완료 조건이 명확한지 확인
  - blocked 카드: 대기 사유만 표시되고 잠금 서브퀘스트/완료/재개 조작이 없는지 확인

- [ ] **7단계 — 실제 산출물 재생성**
  - 8/13 plan과 8/14 board를 재생성한다.
  - receipt의 `ready`와 실제 API board payload를 따로 검증한다.

## 금지사항

- closeout 문장을 그대로 카드 제목으로 복사하지 말 것.
- `record_quality=aligned`만으로 전체 업무가 확인됐다고 판단하지 말 것.
- 대화 coverage unavailable을 조용히 누락하지 말 것.
- `[local path]`, `<drive>:\...`, 사용자 컴퓨터별 절대 경로를 보드에 남기지 말 것.
- 2099 테스트 handoff를 현재 날짜 보드에 병합하지 말 것.
- 사용자의 완료 클릭을 독립 검증 완료로 승격하지 말 것.
- AIHUB 원본 일일보고서·worklog를 애플리케이션이 덮어쓰지 말 것.

## 검증 명령

저장소에서 다음을 모두 실행하고 결과를 기록한다.

```powershell
python <AIHUB>/04_Operations_And_Automation/Memory_System/conversation_bridge/daybridge_quest_extractor.py --self-test
python -m py_compile <AIHUB>/04_Operations_And_Automation/Memory_System/conversation_bridge/daybridge_quest_extractor.py
pnpm test:compiler
pnpm check
pnpm build
```

추가로 확인할 것:

- `Invoke-RestMethod http://127.0.0.1:39393/api/board?date=2026-08-14`에서 카드 수·제목·상태·경고를 확인
- 8/13 `tomorrow_first_steps` 3개가 모두 보존되거나 제외 이유가 있는지 확인
- `latest_daybridge_handoff.json`의 미래/테스트 이벤트가 현재 보드에 없는지 확인
- Git diff에 비밀값과 컴퓨터 절대 경로가 없는지 확인

## 완료 보고 형식

다음 세션은 아래 순서로 보고한다.

1. 변경 파일과 데이터 흐름
2. 8/13 사례의 변환 결과(카드별 제목·상태·단계 수)
3. 누락/제외 항목과 이유
4. 테스트·API·UI 검증 결과
5. 남은 차단과 다음 closeout에서 확인할 항목
6. 커밋 SHA와 `origin/main` 반영 여부
