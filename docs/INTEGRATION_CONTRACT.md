# AIHUB → Daybridge 일정 입력 계약

이 문서는 어떤 Codex 세션에서든 사용자가 등록을 결정한 업무를 Daybridge가 **실행 가능한 작업 후보**로 받아 시간표에 배치하는 경계를 정의한다. closeout·브리핑은 선택적인 원문 공급원이며, 일정 등록의 선행 조건이 아니다. closeout 원문과 캘린더 원본 자체를 시간표에 넣지는 않는다.

## 결론

- Codex 세션은 고정 시각이 없는 **작업 후보(Quest Plan 또는 Markdown inbox)** 를 전달한다.
- Daybridge는 후보를 검증한 뒤, Google Calendar의 busy block과 근무시간 규칙을 합쳐 `DailySchedule`을 만든다.
- 시간표의 한 칸은 항상 `HH:00–HH:50`인 50분 집중 단위다. 후보의 분량은 `focus_units`로 전달한다.
- `start_at`, `end_at` 같은 고정 시각은 Quest에 넣지 않는다. 약속·회의·점심시간은 Calendar busy block 또는 Daybridge 설정으로만 전달한다.
- 질문·확인 요청·자동화 감시 항목은 `review_queue` 또는 `excluded`에 남기고 작업 큐에 자동으로 넣지 않는다.

## 데이터 흐름과 책임

```text
현재 Codex 세션에서 사용자가 등록 결정
        ↓ 업무 정규화·보안 확인
daybridge-schedule-writer Skill
        ↓ 날짜별 Markdown inbox (기본 경로)
        ├──────────────────────────────┐
        │                              │
선택: AIHUB 상세 closeout → Quest Extractor → daybridge_quest_plan
        └────────────── 선택 경로 ───────┘
                       ↓ 로컬 파일 fingerprint 감시
Daybridge 입력 검증기
        ↓ accepted / review_queue / excluded / warnings
50분 슬롯 스케줄러
        + Google Calendar busy ranges (읽기 전용)
        + 근무시간·점심시간 설정
        ↓
DailySchedule + 사용자 receipt
```

| 데이터 | 생성자 | Daybridge의 권한 |
|---|---|---|
| closeout·일기·worklog | AIHUB | 읽기 전용 소비 |
| `daybridge_quest_plan` | AIHUB Quest Extractor | 읽기 전용 소비 |
| 날짜별 `schedule-YYYY-MM-DD.md` | `daybridge-schedule-writer` Skill을 실행한 Codex 세션 | 검증·upsert 후 읽기 전용 소비 |
| Calendar busy range | 사용자 캘린더 | 시작·종료 시각만 읽기 |
| `DailySchedule`·receipt | Daybridge | 생성·수정 |
| `review_queue` | AIHUB | 표시·확인 대기, 자동 실행 금지 |

## 세션 간 전달: 날짜별 Markdown inbox

어떤 Codex 세션에서든 사용자가 등록을 결정한 순간, 일정 후보를 별도의 로컬 파일로 인계할 수 있다. closeout을 만든 세션과 위젯을 실행하는 세션을 결합할 필요가 없다. 정본 위치는 `Daybridge/inbox/schedule-YYYY-MM-DD.md`이며, 실제 기본 경로는 `%LOCALAPPDATA%\Daybridge\inbox\schedule-YYYY-MM-DD.md`다. 파일은 날짜별로 분리하므로 다음 날 기록이 전날 큐를 덮어쓰지 않는다.

파일은 `daybridge-schedule-writer` Skill이 생성한다. Skill은 업무 제목·50분 단위·상태·선행 관계·첫 행동·완료 기준을 검증하고 stable `id` 기준으로 upsert한다. 고정 시각, Calendar 이벤트 내용, 내부 절대 경로와 민감정보는 거부한다. Daybridge는 파일의 fingerprint가 바뀌었을 때 `/api/schedule` 요청에서 자동으로 다시 배치하며, 파싱 오류가 있으면 기존 시간표를 지운 채 교체하지 않는다.

디버깅에는 `GET /api/schedule/inbox?date=YYYY-MM-DD`를 사용한다. 이 응답의 `valid`, `tasks`, `excluded`, `errors`, `fingerprint`를 먼저 확인한 뒤 `POST /api/schedule/rebuild` 또는 위젯의 재배치를 실행한다. 파일 기록 성공은 일정 후보 전달 성공을 뜻할 뿐, 업무 완료나 실제 시간표 반영을 뜻하지 않는다.

## 정식 전달 포맷: `daybridge_quest_plan` 1.1

```json
{
  "artifact_type": "daybridge_quest_plan",
  "schema_version": "1.1",
  "source_date": "2026-08-25",
  "schedule_date": "2026-08-26",
  "status": "ready",
  "source": {
    "kind": "aihub_closeout",
    "refs": ["aihub://2026-08-25/closeout"],
    "coverage": "complete",
    "quality": "aligned",
    "warnings": []
  },
  "quests": [
    {
      "id": "quest-linux-source",
      "mission_id": "mission-linux",
      "title": "공식 문서에서 systemd 서비스 상태 확인",
      "schedule_title": "systemd 상태 확인",
      "actor": "user",
      "kind": "review",
      "priority": "must",
      "execution": "sequential",
      "depends_on": [],
      "state": "ready",
      "focus_units": 1,
      "remaining_units": 1,
      "first_action": "공식 문서를 열고 서비스 상태 명령을 실행한다",
      "done_when": "상태와 관찰 결과를 기록한다",
      "steps": [
        { "id": "step-open", "label": "공식 문서와 테스트 환경을 연다", "completed": false },
        { "id": "step-record", "label": "상태와 결과를 기록한다", "completed": false, "depends_on": ["step-open"] }
      ],
      "source_refs": ["aihub://2026-08-25/closeout#linux"]
    },
    {
      "id": "quest-write-note",
      "mission_id": "mission-linux",
      "title": "확인 결과를 학습 노트에 기록",
      "schedule_title": "학습 결과 기록",
      "actor": "user",
      "kind": "execute",
      "priority": "should",
      "execution": "independent",
      "depends_on": ["quest-linux-source"],
      "state": "ready",
      "focus_units": 1,
      "remaining_units": 1,
      "first_action": "관찰 결과의 핵심 세 줄을 작성한다",
      "done_when": "노트에 결과와 다음 행동이 남아 있다",
      "source_refs": ["aihub://2026-08-25/closeout#linux"]
    }
  ],
  "review_queue": [
    {
      "id": "review-calendar",
      "question": "캘린더의 오후 외부 일정이 실제 약속인지 확인",
      "reason": "needs_user_confirmation",
      "source_refs": ["aihub://2026-08-25/closeout#calendar"]
    }
  ],
  "excluded": [
    {
      "id": "excluded-monitor",
      "title": "다음 자동화 실행을 감시",
      "reason": "automation_monitoring",
      "source_refs": ["aihub://2026-08-25/closeout"]
    }
  ]
}
```

### 필드 규칙

#### Envelope

- `artifact_type`는 고정값 `daybridge_quest_plan`이다.
- `schema_version`은 현재 `1.1`이다. 컴파일러는 기존 `1.0`도 호환하지만, 새 산출물은 `1.1`로 만든다.
- `source_date`는 근거가 만들어진 closeout 날짜, `schedule_date`는 실제 배치할 날짜다. 기존 `activity_date`는 `source_date`의 호환 별칭으로만 허용한다.
- 두 날짜는 `YYYY-MM-DD`이며 `schedule_date`는 `source_date`보다 빠를 수 없다.
- `status=blocked`인 패킷은 새 시간표를 만들지 않는다. `status=attention`은 명시된 안전한 후보만 배치하고 경고를 보존한다.
- `source.coverage`와 `source.quality`는 서로 다른 값이다. `coverage`가 `complete`여도 `quality`가 자동으로 aligned가 되는 것은 아니다.

#### Quest

- `id`는 날짜가 바뀌어도 유지되는 안정적인 ID다. 중복 ID는 거부한다.
- `title`은 한 작업의 한 결과를 나타내는 실행 문장이다. closeout 전문, 내부 경로, 비밀값, 여러 일을 이어 붙인 문단을 넣지 않는다.
- `schedule_title`은 시간표에 보일 짧은 이름(권장 32자 이하)이다. 생략하면 Daybridge가 안전한 축약명을 만든다.
- `actor`는 현재 `user`만 작업 큐에 들어간다. 자동화·Codex·정책 확인은 `excluded`로 보낸다.
- `kind`는 `execute`, `review`, `decision` 중 하나다. `decision`이어도 질문 자체가 아니라 사용자가 완료할 명확한 결정 결과가 있어야 한다.
- `priority`는 `must`, `should`, `could` 중 하나다.
- `state`는 `ready`, `in_progress`, `deferred`, `blocked`, `completed` 중 하나다. `completed`·`blocked`는 시간표에 넣지 않는다. `deferred`는 다음 날 carryover 후보로 남긴다.
- `execution=sequential`이면 단계 순서를 보존한다. `depends_on`은 다른 Quest ID, Step의 `depends_on`은 같은 Quest 안의 Step ID만 가리킨다. 단순 작업을 형식적으로 여러 단계로 쪼개지 않는다.
- `focus_units`는 필요한 50분 집중 단위 수(양의 정수)다. `remaining_units`는 현재 남은 단위 수이며 `focus_units`보다 클 수 없다. 예: 100분 작업은 `focus_units: 2`다.
- `estimate_minutes`·`remaining_minutes`는 1.0 호환용이다. 새 패킷에서는 스케줄링 기준으로 사용하지 않고 `focus_units`를 사용한다.
- `first_action`은 지금 당장 시작할 한 행동, `done_when`은 사용자가 완료를 판단할 관찰 가능한 결과다. 없으면 입력 검증 경고가 발생하며 제목으로 보완된다.
- `source_refs`는 `aihub://`, `record://` 같은 안전한 참조만 담는다. 컴퓨터 절대 경로, 토큰, 메일·전화번호를 넣지 않는다.
- Quest에는 `start_at`, `end_at`을 넣지 않는다. 고정 시각이 필요한 항목은 캘린더 일정으로 전달한다.

### 50분 단위 예시

| 작업 | 전달 값 | 결과 |
|---|---:|---|
| 리눅스 학습 | `focus_units: 1` | `09:00–09:50` 한 칸 |
| 문서 검토 + 결과 기록 | `focus_units: 2` | `09:00–09:50`, `10:00–10:50` |
| 전날 3칸 중 1칸 완료 | `focus_units: 3`, `remaining_units: 2` | 남은 두 칸만 재배치 |

짧은 15분·25분 메모도 사용자 시간표에서는 한 50분 슬롯을 예약해야 한다. 분량을 25분으로 전달해도 반쪽 슬롯으로 표시되지 않는다.

## 자동 배치 규칙

1. 입력 검증기가 `accepted`, `review_queue`, `excluded`, `warnings`를 만든다.
2. `accepted` 중 완료·차단 후보를 제외하고, 누락된 의존성은 숨기지 않고 `dependency_missing`으로 표시한다.
3. 기존 receipt와 같은 `id`는 상태·완료 step을 이어받는다. 날짜가 바뀌고 미완료면 `carryover`로 재배치한다.
4. briefing 후보를 먼저 정렬하고 routine 후보는 남는 슬롯에만 넣는다. 우선순위는 `must → should → could`다.
5. Daybridge 설정의 근무시간(기본 09:00–18:00), 점심시간(기본 11:30–13:00), Calendar busy block을 합친 뒤 `HH:00–HH:50` 슬롯만 생성한다.
6. 후보에 고정 시각이 있으면 후보를 조용히 이동하지 않고 `fixed_time_not_allowed`로 제외한다. 회의·약속은 Calendar에서 읽어 busy block으로만 반영한다.
7. 시간이 부족하면 후보를 삭제하지 않고 `unscheduled`에 `insufficient_time`과 남은 단위를 기록한다.
8. `review_queue`와 `excluded`는 화면·receipt에서 확인 가능해야 하지만 자동 작업으로 승격하지 않는다.

## 검증 결과 형태

입력 검증기는 다음 구조를 반환한다. 이 결과는 시간표와 함께 디버깅·후속 회고에 남긴다.

```json
{
  "valid": true,
  "status": "accepted",
  "accepted": [{ "id": "quest-linux-source", "focus_units": 1 }],
  "review_queue": [],
  "excluded": [],
  "warnings": [],
  "errors": []
}
```

`valid=false`이면 새 시간표를 만들지 않는다. `status=attention`이면 안전하게 검증된 후보만 배치하고, 경고·제외·확인 대기를 보드의 메타데이터로 보존한다.

## 현재 코드와의 차이 및 교정 사항

현재 구현을 대조한 결과 다음을 계약에 반영했다.

- 기존 closeout fallback은 `confirmation_questions`를 `decision` Quest로 바꿀 수 있었다. 이제 질문은 `review_queue`에만 보관한다.
- 기존 입력은 `estimate_minutes`를 5~90으로 임의 보정했지만, 실제 스케줄러는 모든 작업을 50분 블록으로 만든다. 새 경계는 `focus_units`를 정본으로 삼고, 1.0의 분량 필드는 호환용으로만 변환한다.
- 기존 Quest Plan은 입력 별칭과 누락 필드를 넓게 허용했다. 이제 `validateQuestPlan`이 artifact/version/date/status/actor/kind/state/단위/고정시각/보안 경계를 먼저 검사한다.
- Calendar busy 정보는 제목·참석자·본문이 아니라 검증된 `startAt`/`endAt` 범위만 스케줄러에 전달한다.

## 수신자가 지켜야 할 금지 사항

- closeout 원문을 직접 시간표 카드로 표시하지 않는다.
- AIHUB의 내부 운영 작업, 자동화 감시, 확인 질문을 사용자 업무로 추론하지 않는다.
- 후보의 `title`을 근거로 완료로 추론하지 않는다. 완료는 사용자의 Daybridge receipt로만 기록한다.
- coverage가 unavailable·blocked인 상태를 정상적인 `complete`으로 바꾸지 않는다.
- 새로운 고정 시각 필드를 임의로 추가하지 않는다. 계약 변경이 필요하면 schema version을 올린다.
