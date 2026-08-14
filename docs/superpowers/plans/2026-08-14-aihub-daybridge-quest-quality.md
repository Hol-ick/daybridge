# AIHUB → Daybridge 퀘스트 품질 개선 기획안

> **실행 에이전트 안내:** 이 문서는 2026-08-13 closeout 결과를 기준으로 작성된 실행 전 기획안이다. 구현은 아래 지시서의 단계와 수용 기준을 순서대로 따른다.

## 목표

AIHUB closeout의 상세 기록을 보존하면서, 다음 날 사용자가 실제로 수행할 수 있는 작고 명확한 퀘스트만 Daybridge에 노출한다.

핵심은 `보고서가 ready인가`가 아니라 다음 세 가지를 동시에 만족하는 것이다.

1. 사용자가 카드 제목만 읽고 첫 행동을 이해한다.
2. 한 카드가 한 결과를 향한 짧은 작업 단위로 쪼개진다.
3. coverage·차단·검증 불가 상태를 완료처럼 숨기지 않는다.

## 2026-08-13 검증 결과

### 확인된 사실

- closeout 상태는 `success / healthy / aligned`다.
- 대화 세션의 today/all-history coverage는 `unavailable`이다.
- shutdown은 차단되어 실행되지 않았다.
- 8/14 실제 브리지 보드에는 3개 퀘스트가 들어왔다.
- 컴파일러 테스트는 5/5 통과했다.
- `2026-08-13_daybridge_board.json`의 `ready`는 보드 생성 receipt일 뿐, 사용자용 퀘스트 품질을 보증하지 않는다.
- `latest_daybridge_handoff.json`은 `2099-01-01`의 테스트 이벤트를 가리키므로 실데이터로 사용하면 안 된다.

### 현재 보드의 문제

1. **상황 설명이 행동으로 변환되지 않음**
   - “구형 Vite 개발 서버와 Excel·VS Code가 옛 KTH 경로를 붙잡아…”처럼 원인·위험 서술이 카드 제목으로 노출된다.
   - “이전 배포 asset을 제공해 반영 여부가 남아 있다”도 사용자가 누를 행동이 아니다.

2. **한 단계 카드가 실제로는 여러 작업을 숨김**
   - 프로세스 확인 → 종료 → 옛 경로 잔여 확인 → 새 루트 재시작이 하나의 문장으로 뭉쳐 있다.
   - 배포 반영 확인도 Actions 확인 → 공개 asset 확인 → 모바일 smoke 재실행으로 분리되어야 한다.

3. **차단 카드가 실행 불가능함**
   - `[local path]`로 마스킹된 경로가 첫 행동에 남아 있어 사용자가 어디를 확인할지 알 수 없다.
   - 차단 상태는 “사용자가 지금 할 일”이 아니라 “외부 조건이 풀리면 재시도할 항목”으로 표현해야 한다.

4. **closeout의 명시적 내일 첫 행동이 누락될 수 있음**
   - 8/13 보고서의 `내일 첫 행동`에는 bounded `list_threads` 재시도가 있었지만, 현재 Quest Plan에는 그 항목이 나타나지 않는다.
   - 명시적 `tomorrow_first_steps`는 추출 결과에서 누락되거나 조용히 버려지면 안 된다. 제외한다면 이유를 `excluded`에 남겨야 한다.

5. **coverage 경계가 보드에 전달되지 않음**
   - `record_quality=aligned`는 기록 간 정합성이지, 대화 전체 coverage나 shutdown 완료를 뜻하지 않는다.
   - 대화 coverage가 unavailable이거나 shutdown이 blocked이면 보드에 `attention` 경고를 남기고, “오늘 업무 전체를 빠짐없이 반영했다”고 표시하지 않는다.

## 목표 데이터 흐름

```text
closeout synthesis
  ├─ tomorrow_first_steps  → 사용자 퀘스트 후보
  ├─ open_items            → 확인 필요/차단 후보
  ├─ confirmation_questions → 질문 후보(자동 퀘스트 금지)
  └─ coverage/health        → 보드 품질 경고

quest normalizer
  ├─ 실행 가능한 동사형 제목
  ├─ 1개 결과 단위
  ├─ 순차 단계(필요한 경우만)
  ├─ ready / blocked / needs-review 분류
  └─ 원본 source_refs 보존

Daybridge board
  ├─ 사용자 카드: 실행 가능한 것만
  ├─ 대기 카드: 외부 조건만
  └─ 보드 경고: coverage·shutdown·합성 데이터 문제
```

## 상태·노출 규칙

| 원본 상태 | Daybridge 노출 | 규칙 |
|---|---|---|
| 구체적인 사용자 행동과 완료 조건이 있음 | `ready` | 카드 제목은 동사형, 첫 단계는 5~30분 단위 |
| 이전 단계가 끝나야 다음 단계가 열림 | `ready` + `execution=sequential` | 단계별 `dependsOn`을 사용 |
| 외부 응답·배포·접근 권한을 기다림 | `blocked` | 잠금 서브퀘스트를 만들지 말고 대기 사유만 표시 |
| 사용자의 사실 확인이나 선택이 필요 | `needs_confirmation` 후보 | 자동 완료 퀘스트로 만들지 말고 별도 확인 항목으로 보존 |
| closeout에 완료 근거가 있음 | history/완료 기록 | Daybridge 클릭만으로 완료 검증을 승격하지 않음 |
| `candidate_only`, test fixture, 미래 날짜 handoff | 노출 금지 | `excluded` 또는 품질 경고에 기록 |

## 8/13 사례의 기대 변환

### 카드 A — 옛 작업 경로 재검증

- 제목: `옛 KTH 경로를 재생성하는 프로세스 확인`
- 단계:
  1. 구형 Vite·Excel·VS Code 프로세스가 옛 논리 alias를 사용하는지 확인
  2. 해당 프로세스를 종료한 뒤 옛 경로의 잔여 파일/재생성 여부 확인
  3. `.THK` 기준으로 필요한 프로젝트만 다시 시작
- 완료 조건: 결과와 확인 근거가 worklog에 기록됨
- 상태: 프로세스가 아직 살아 있으면 `blocked` 또는 `in_progress`; 사용자가 확인 가능한 경우 `ready`

### 카드 B — `4f56665` 공개 반영 검증

- 제목: `4f56665 공개 asset 반영 여부 확인`
- 단계:
  1. GitHub Actions와 Cloudflare Pages 배포 상태 확인
  2. 공개 도메인의 번들/릴리스 식별자가 `4f56665`인지 확인
  3. 새 asset이면 공개 모바일 smoke 재실행
- 완료 조건: 반영 여부와 smoke 결과가 worklog에 기록됨
- 상태: 외부 배포 접근이 없으면 `blocked`

### 카드 C — 대화 coverage 재시도

- 제목: `Codex 대화 coverage 재시도`
- 단계: bounded `list_threads`를 재시도하고 today/all-history 범위를 기록
- 완료 조건: coverage 결과가 AIHUB 기록에 남음
- 상태: 실행 가능하면 `ready`, API timeout이면 `blocked`

## 수용 기준

- [ ] 8/13 fixture에서 보고서의 `내일 첫 행동` 3개가 모두 보존되거나, 제외 이유가 명시된다.
- [ ] 카드 제목에 “~일 수 있다”, “~남아 있다” 같은 상황 서술만 남지 않는다.
- [ ] A와 B는 각각 2개 이상 단계로 분해되고, 불필요한 단계는 만들지 않는다.
- [ ] `[local path]`, 컴퓨터 절대 경로, credential, test fixture가 사용자 카드에 노출되지 않는다.
- [ ] coverage unavailable과 shutdown blocked가 `sourceWarnings` 또는 동등한 보드 메타데이터에 남는다.
- [ ] `2099-01-01` 테스트 handoff가 현재 날짜 보드에 유입되지 않는다.
- [ ] blocked 카드는 잠금 서브퀘스트·완료 버튼·재개 버튼 없이 대기 사유만 표시한다.
- [ ] 기존 상태 보존, carryover, Daybridge status report mirror가 깨지지 않는다.
- [ ] 컴파일러 테스트, TypeScript 검사, production build, 브리지 API smoke가 모두 통과한다.

## 범위 밖

- 이번 작업에서 AIHUB 원본 worklog나 일일보고서의 사실을 수정하지 않는다.
- 실제 프로세스 종료, 배포 재실행, GitHub PAT audit, 대화 세션 보관을 자동으로 수행하지 않는다.
- Supabase 연결이나 DB 스키마 변경은 이 작업의 선행 조건이 아니다.

