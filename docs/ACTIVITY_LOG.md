# Daybridge 활동 로그

Daybridge는 사용자가 위젯에서 실제로 성공시킨 조작을 로컬 활동 이력으로 남긴다. 이 기록은 다른 Codex 세션이 오늘 사용자가 Daybridge에서 무엇을 추가·변경했는지 확인하는 입력이며, 원본 일기나 업무 시스템을 수정하지 않는다.

## 저장 위치

- 사람이 읽는 일지: `%LOCALAPPDATA%\Daybridge\activity\YYYY-MM-DD.md`
- 기계가 읽는 정본: `%LOCALAPPDATA%\Daybridge\activity\YYYY-MM-DD.ndjson`

NDJSON은 append-only 정본이다. Markdown 파일은 같은 날짜의 정본을 읽기 편하게 렌더링한 보기이며, 다음 기록이 생길 때 다시 생성된다.

## 기록되는 조작

성공 응답을 받은 경우에만 다음 action을 한 건씩 기록한다.

| action | 의미 |
| --- | --- |
| `task_added` | 수동 작업을 추가함 |
| `status_changed` | 작업의 상태를 변경함 |
| `task_reordered` | 카드의 순서 또는 시간표 위치를 바꿈 |
| `task_removed` | 오늘 목록에서 카드를 제거함 |
| `schedule_rebuilt` | 재배치 버튼으로 일정을 다시 만듦 |
| `schedule_settings_changed` | 근무시간·완충시간 등 시간표 설정을 저장함 |

조회, 자동 새로고침, 화면 열기 같은 읽기 동작은 활동 로그에 쓰지 않는다.

## Codex에서 읽기

브리지가 실행 중이면 다음 요청으로 최근 기록을 읽을 수 있다.

```text
GET http://127.0.0.1:39393/api/activity?date=YYYY-MM-DD&limit=200
```

브리지가 꺼져 있어도 날짜별 Markdown 또는 NDJSON 파일을 직접 읽을 수 있다. 기록에는 제목·변경 종류·시간·안전한 보조 정보만 저장하며, 이메일·전화번호·비밀값·로컬 절대 경로는 치환한다.

## 해석 경계

활동 로그는 Daybridge에서 받은 사용자 조작 receipt다. 예를 들어 `status_changed: completed`는 사용자가 위젯에서 완료로 표시했다는 근거이지, 외부 시스템에서의 배포·메일 발송·문서 반영까지 자동으로 증명하지는 않는다.
