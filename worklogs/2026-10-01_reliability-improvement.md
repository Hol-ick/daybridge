# Daybridge 신뢰성 개선 실행 체크포인트

- 계획 정본: `MARU:/04_Operations_And_Automation/Memory_System/skill_workspace/plans/2026-10-01-daybridge-reliability-improvement.md`.
- 기준선: main/e59a91e. 기존 분석·기획 worklog 2개는 보존했다. preflight에서 실제 루트와 main 정책, 원격 main과 기준선 일치를 확인했다.
- 작업 0: 운영 health/storage/calendar만 읽었다. pointer와 실행 경로 불일치 및 handoff 미연결은 `operational_path_unresolved`다. 두 위치의 boards/schedules/inbox 54개 파일을 비교했고 검증 전후 기존 파일 해시 변경은 0개다. 운영 자료 이동·실행 앱 재시작·Calendar 연결은 하지 않았다.
- 작업 1: 공통 fixture 기동기는 LOCALAPPDATA와 데이터 폴더를 각각 임시 루트 안에 만든다. 운영 프로필 전달을 차단하고 handoff sink를 null로 고정한다. OS가 포트를 할당하며 health의 실제 데이터 경로 확인 후 호출을 허용한다. 자식 종료를 기다리고 자기 임시 루트만 정리한다. 기존 API 통합 테스트 3개 파일에 적용했다.
- 격리 실패 재현: 가짜 부모 pointer가 보호용 fixture 폴더를 가리킬 때 LOCALAPPDATA 격리를 제거하면 경로 검사가 실패한다. 안전한 구현을 복구한 뒤 보호 파일 보존·추가 파일 없음·서로 다른 포트·listener 종료를 확인했다. 실제 운영 환경으로 위험한 방식을 시험하지 않았다.
- 작업 2: Host와 Origin을 body 읽기 전에 검사한다. 변경 요청은 JSON 미디어 타입을 요구한다. 미허용 요청/미디어 타입/깨진 JSON/128 KiB 초과에 각각 403/415/400/413을 반환한다. chunked 크기 초과도 검사했다. 거부 요청의 board/schedule/event/activity 변화가 없고, 허용 CLI/Tauri와 CORS/OPTIONS가 정상임을 확인했다.
- 요청 실패 재현: 미허용 Origin의 text/plain 수동 등록이 수정 전 201이었다. 수정 뒤 403이며 저장 상태 불변이다. Calendar 연결 UI 요청도 JSON 계약에 맞췄다.
- 브라우저 검증 준비: 모든 브리지 API의 기본 차단과 미등록 요청 수집을 추가했다. 공유 background mock과 시나리오 mock만 허용한다. 서비스워커는 차단하고 날짜는 고정했다. 실패 때 화면·DOM·미등록 요청을 로컬 test-artifacts에 보존한다.
- 작업 8 선행 수정: 실제 DOM/화면에서 오래된 설정 선택자와 탭 구조, 별도 dashboard 설정 창을 확인했다. 브라우저에서 Tauri 이벤트 listen을 호출하던 오류를 guard와 정리 처리로 수정했다. 브라우저 설정 버튼은 별도 dashboard를 연다. drag trash 영역 생성 후 바뀐 좌표를 다시 읽고, 실제 API 응답을 기다리도록 smoke를 고쳤다. 기대값만 바꾸거나 페이지 오류를 무시하지 않았다.
- 최신 검증: 격리/HTTP/API Node 테스트 18개 통과, browser smoke 11개 시나리오 통과, 미등록 요청과 페이지 오류 없음, 웹 build 통과, git diff --check 통과. 설정 창 렌더링을 직접 확인했다. 기존 타입 검사 범위의 한계는 작업 8에서 계속 해결한다.
- 전달: 이 체크포인트의 구현·시험·기록 경로만 커밋 대상이다. 앞선 읽기 전용 분석·기획 worklog는 이 구현 커밋에 포함하지 않는다.
- 다음: 작업 3의 엄격한 JSON 읽기, 날짜별 직렬화·프로세스 잠금·journal 복구부터 진행한다. 동시 저장·손상 복구, 중복 억제/outbox, 이월, 설정 계약, 실행 진단, 전체 JS/JSX 검사·CI, 독립 패키지, 최종 문서는 아직 미완료다. Codex 전체 목표는 active로 유지한다.

## 작업 3: 저장 경계와 복구

- 시작 기준: main/15f2903. preflight에서 저장소·main·원격 일치를 재확인했다. 기존 분석·기획 기록은 보존했다.
- 실패 재현: 카드 20개 동시 보고에서 성공은 14개였다. 손상 일정은 null로 처리됐고, 손상 보드는 compiler와 수동 추가가 덮어썼다. 새 회귀 검사의 4개 실패를 출발점으로 삼았다.
- 엄격한 읽기: ENOENT만 null이다. 파싱·형식·권한·읽기 오류를 StoreError로 구분하고 원본을 보존한다. 보드 quests와 일정 blocks의 잘못된 형식도 빈 목록으로 바꾸지 않는다. JSON rename의 Windows 공유 오류는 제한된 재시도 후 실패시키며 무한 재시도하지 않는다.
- 잠금: 프로세스 내부 큐와 날짜별 exclusive lock을 적용했다. latest.json·설정·여러 날짜의 조회도 같은 자료를 공유하므로 추가 store gate로 전체 반영 중 읽기를 차단한다. 잠금 대기는 2초 뒤 409 conflict다. 소유자 PID의 종료가 확인된 잠금만 회수하며 살아 있거나 소유자가 불명확하면 보존한다.
- 복구: 최종 JSON 값들을 prepared journal에 먼저 저장한다. 준비된 journal은 잠금 아래 같은 최종값으로 재적용하고 settled로 표시한다. 손상 journal·경계 밖 대상은 원본을 유지하며 중단한다. junction 경로도 실제 경계를 검사한다. 정상 조회와 성공 응답은 복구·반영 뒤에만 전달한다.
- 호출부: 브리지의 보드/일정 처리 전체를 최상위 저장 경계로 묶고 응답을 commit 이후에 내보낸다. schedule-store 공개 조회·변경 함수도 같은 경계를 사용한다. 내부 호출은 기존 경계를 재사용하여 중첩 transaction을 만들지 않는다.
- compiler: compile은 비동기 저장 계약을 사용하도록 변경하고 CLI·호출 테스트를 맞췄다. 저장 pointer > 환경 지정 > 기본 위치의 우선순위를 따른다. 같은 날짜의 수동 추가 항목과 상태 보고를 보존하며 날짜 보드와 latest.json을 함께 반영한다. 성공 출력도 commit 뒤에 남긴다. print-only는 조회 경계를 사용하고 보드 JSON을 변경하지 않는다.
- 추가 실패 재현: compiler와 bridge를 동시에 실행하면 상태 보고는 유지됐지만 수동 항목은 지워졌다. 수동 항목 보존을 추가한 뒤 보고 10개·수동 항목·latest 보드 일치를 확인했다.
- 검증: 격리한 설정 환경에서 관련 Node 49개 모두 통과. 20개 동시 변경, 별도 프로세스 2개의 보고·증가, 첫 쓰기 직후 프로세스 종료와 새 프로세스 복구, 중간 rename 실패와 조회 차단, 살아 있는/알 수 없는 잠금 보존, 손상·탈출 journal, junction 경계, HTTP 보드·일정 동시 반영, compiler/bridge 경합을 포함한다. 이후 compiler의 실제 pointer 우선순위 검사 1개를 추가하고 저장 회귀 14개 전체를 다시 통과했다. Windows 실제 공유 잠금 60ms를 걸었다가 해제하는 별도 probe에서 97ms 후 rename 저장 성공을 확인했다. 웹 build·compiler self-test·diff 검사 통과. 운영 비교 대상 기존 54개 파일 해시 변경 0.
- 시험 폴더: 셸 검증 명령의 임시 폴더 정리 부분이 자동 검토에서 거부되어 해당 명령은 실행되지 않았다. 삭제를 포함하지 않는 검증 명령으로 49개 검사를 실행했다. 시험 전체에 사용한 빈 설정 폴더 하나와 공유 잠금 probe의 결과 폴더는 임시 영역에 보존했으며 운영 자료와 분리되어 있다. 각 fixture 기동기의 자식 종료·자기 폴더 정리는 기존 검증대로 수행됐다.
- 남은 경계: handoff 외부 전달과 activity append의 부분 실패·재시도·중복 억제는 작업 4 대상이다. 저장 journal 반영 성공이 외부 전달 성공을 뜻하지 않는다. 실제 앱 교체·운영 경로 정본 결정·자료 이동은 하지 않았다.
- 다음: 작업 4의 요청 ID·payload 해시·동일 요청 재생, outbox와 UI 재시도 계약을 구현한다. 작업 4–10과 전체 목표는 미완료이며 active로 유지한다.

## 작업 4 진행: 요청 영수증과 재생

- 기존 동일 요청 ID의 수동 등록이 다른 quest ID 두 개를 만드는 실패를 재현했다.
- mutation-service는 ID의 안전한 형식과 canonical payload 해시를 확인한다. 영수증은 상태 변경과 같은 journal에 저장하고 자동 삭제하지 않는다. 날짜·라우트·내용이 다른 ID 재사용은 409이며 구형 ID 없는 요청도 처리한다.
- 같은 요청의 재생은 최초 상태 코드와 본문을 반환하며 현재 요청의 CORS 정책을 적용한다. 진단·저장 위치 변경·OAuth 라우트는 재생 대상에서 제외한다.
- 검증: 관련 Node 22개 통과. 새 회귀 3개는 동일 HTTP 재전송의 quest/event/activity 1개, 20개 동시 요청의 실행 1회, 새 프로세스에서 영수증 재생, payload 순서 차이, 날짜 변경 충돌, 실패 시 staged 상태 롤백과 같은 ID 재시도를 포함한다. 마지막 경계 보완 뒤 새 회귀 3개 재실행 통과. diff 검사 통과.
- HTTP 시험은 첫 결과를 버리고 재요청한 경우를 검사한다. 실제 연결 단절 주입과 자동 클라이언트 복구, 외부 sink 실패는 아직 검사하지 않았다.
- 남은 작업 4: outbox를 같은 commit에 포함, activity append를 저장 경계와 정합화, commit 후 외부 전달과 pending 안내, 제한된 클라이언트 재시도. 작업 4 전체와 A10은 미완료다. 운영 앱과 자료 위치는 변경하지 않았다.

## 작업 4 진행: 전달 대기열과 확정 활동 기록

- 수정 전 전달 대상에 쓰기 불가능한 fixture에서는 수동 등록이 500을 반환했다. 수정 후 로컬 event·outbox·activity JSON과 요청 영수증을 상태 변경과 같은 journal에 저장하며 외부 전달은 commit 이후 수행한다.
- 전달 실패는 local_saved/pending 응답이다. 안정 event ID를 파일명으로 쓰고 같은 내용만 재전송한다. 손상되거나 다른 내용의 대상은 덮어쓰지 않는다. 처리 수는 기본 20개이며 미전달 항목은 유지한다. 브리지 시작·30초 주기·변경 응답 시 전달을 재시도한다.
- 전달 폴더는 물리 경로에서도 로컬 저장 밖이어야 한다. junction으로 내부 경로를 가리키는 대상도 거부한다. 실제 MARU sink로 시험하지 않았다.
- 활동 JSON을 저장 정본으로 사용한다. legacy NDJSON 원본은 보존하고 별도 committed NDJSON·Markdown을 출력한다. 출력 실패는 확정 기록을 취소하지 않으며 projectionPending 표시와 후속 복구를 지원한다. 저장 중단은 성공 활동 기록도 남기지 않는다.
- 검증: 관련 Node 36개 통과. 전달 쓰기 실패와 동일 ID 재시도, 외부 전달 후 확인 단계의 실패와 새 프로세스 재전송, 실패한 로컬 transaction의 activity/outbox 부재, 손상 대상 보존·제한 처리, legacy 원본 보존·출력 재생성을 확인했다. 물리 경계 보완 뒤 관련 6개 통과, junction 검사 추가 뒤 outbox 5개 통과. diff 검사 통과.
- 전달 후 확인 실패는 test hook으로 재현했다. 해당 순간 실제 OS 프로세스 강제 종료는 주입하지 않았다. HTTP 응답 스트림 단절·자동 클라이언트 복구·pending 사용자 화면은 다음 검증 대상이다.
- 작업 4 및 A10 전체는 미완료다. 이번 구현은 백엔드 저장과 재전송이다. 실제 운영 앱 재시작·설치·자료 이동을 하지 않았다.

## 작업 4 진행: 클라이언트 재시도와 전달 안내

- bridge-client를 일정 화면과 AppContext 보고에 연결했다. 한 사용자 동작에 UUID를 한 번 발급하며 재시도에도 ID·본문을 유지한다. GET과 서버 재생 계약이 있는 ID 포함 변경만 1회 재시도한다. 저장 폴더·OAuth 등 진단 변경과 구형 ID 없는 변경은 자동 재시도하지 않는다.
- 각 요청과 복구 호출은 5초 이내로 제한하며 응답 본문까지 소비한다. 취소 시 재시도하지 않고 복구 도중 취소도 다음 요청을 막는다. HTTP 오류는 네트워크 오류처럼 재전송하지 않는다.
- 취소·복구 경합 시험에서 unhandled rejection을 발견하고 Promise 경계와 이미 취소된 signal 처리를 수정했다. 실제 HTTP proxy가 최초 저장 후 응답 socket을 끊는 시험에서도 재시도 결과는 quest 1개·event 1개다.
- 로컬 저장 완료와 전달 대기를 성공 안내에 구분해서 표시한다. AppContext 보고 실패를 삼키지 않고 저장 확인 불가 안내를 남긴다.
- 검증: client/receipt/outbox/policy Node 15개 통과, 마지막 Promise 경계 보완 뒤 client 4개 재실행 통과. 브라우저 11개 시나리오와 build·diff 검사 통과. 관리 화면(960×760)과 위젯(320×560)의 전달 대기 안내 캡처를 직접 확인했으며 잘림·겹침 없음. 미등록 브리지 요청과 pageerror 없음.
- build의 Tauri 동적 import는 다른 정적 import와 같은 chunk로 묶이는 경고가 있다. 빌드는 성공했으며 분할 로딩 최적화는 이번 기능의 성공 조건이 아니다.
- 남은 작업 4 검증: fixture 브리지 자체를 재시작했을 때 자동 outbox drain이 발동하는 통합 관찰, 서버 실패 안내의 실제 화면 검사. 신규 프로세스에서 영수증/전달 재생은 검사했으나 이를 해당 통합 관찰의 대체 근거로 쓰지 않는다. 전체 목표는 active다.

## 작업 4 완료: 재시작과 실패 경계의 통합 확인

- fixture에 restart를 추가했다. 기존 시험 프로세스의 종료를 기다리고 같은 격리 데이터에서 새 프로세스를 기동한다. config sink의 논리·물리 경계와 저장 pointer를 기동 전에 검사하며 새 health를 확인한다. 실제 사용자 앱은 재시작하지 않는다.
- 전달 대기 상태에서 시험 bridge PID를 교체했다. 새 변경 요청 없이 시작 시 자동 drain으로 같은 event 파일이 sent가 됐으며, 이후 동일 ID HTTP 재요청도 최초 quest를 재생했다.
- Windows의 실제 독점 파일 잠금으로 읽기 접근 거부 오류를 확인했다. 동일 요청은 201/local_saved/pending이며 원본 bytes를 보존했다. 시험 잠금을 해제하면 같은 이벤트의 전달이 완료됐다. 이는 파일 공유 접근 거부 시험이며 운영 폴더 ACL은 변경하지 않았다.
- 실패 안내 시험에서 입력 폼의 status와 하단 status를 혼동한 선택자를 발견했다. 실제 안내 문구로 대상을 고친 뒤 서버 500은 한 번만 전송되고 입력 제목을 보존하며 저장 확인 실패 안내가 화면에 나타남을 확인했다. 잘못된 제목 안내는 400에만 사용한다.
- 검증: fixture/client/receipt/outbox 관련 Node 16개 통과. Windows 접근 거부 시험 추가 뒤 outbox 7개 모두 통과(건너뜀 0). browser 11개, build, diff 검사 통과. 저장 실패 캡처를 직접 확인했고 문구 잘림·겹침 없음. 시험 서버 종료 확인.
- 작업 4의 요청 중복 억제·같은 journal의 outbox·commit 후 전달·제한 재시도/취소·응답 유실·재시작·접근 거부·사용자 안내를 검증했다. A10은 해당 범위에서 verified다. 실제 운영 적용과 native ensure_local_bridge의 사용자 앱 교체는 목표 밖이다.
- 다음은 작업 5의 날짜 공백 이월·남은 분량·의존 관계 보존이다. 작업 5–10과 전체 목표는 미완료이며 active다.

## 작업 5 진행: 공백 뒤 이월 출처 선택

- 수정 전 공백 날짜의 rebuild에서 이전 열린 작업이 누락되는 실패를 격리된 HTTP fixture로 재현했다. 기본 루틴은 이월 시험에서 비활성화하여 결과를 분리했다.
- findCarryoverSource는 store 경계 아래 YYYY-MM-DD 일정 파일 중 오늘 이전의 최신 파일 하나만 읽는다. 미래 파일·latest 등 다른 이름을 제외하며 여러 과거 날짜를 합산하지 않는다. bridge rebuild가 이 출처를 사용한다.
- 가장 최근의 빈 일정은 의도된 상태로 취급하여 더 오래된 작업을 되살리지 않는다. 손상 JSON·파일명과 본문의 날짜 불일치는 원본을 보존하고 오류로 중단한다.
- 검증: 공백/기존 이월/이동 관련 Node 13개 통과. 손상 날짜 공백·미래 및 비날짜 이름 제외·본문 날짜 불일치 추가 뒤 신규 4개 통과. diff 검사 통과. 같은 날 반복 rebuild와 장기 공백에서도 열린 항목만 한 번 나타난다.
- 남은 작업 5: task metadata·남은 정확한 분량·의존 관계·출처·누적 횟수 보존, 오늘 완료/폐기와 현재 요일 루틴의 충돌 회귀. 작업 5 및 A04 전체는 미완료다. 실제 운영 데이터와 앱은 변경하지 않았다.

## 작업 5 완료: 분량·의존 관계와 오늘 상태 보존

- 실패 재현: 시간 없는 75분 작업이 이월 시 25분으로 바뀌고 시간표의 25분 잔여는 50분으로 늘어났다. 완료한 이월 항목이 보드 quest 없이 rebuild에서 다시 열렸고 75분 목록 항목 폐기는 25분을 되살렸다.
- 새 focus block에는 workMinutes와 정규화한 taskMetadata를 저장한다. unscheduled 항목도 같은 metadata를 보존한다. 명시적인 remainingMinutes가 단위 환산보다 우선하며 슬롯 길이와 실제 작업 분량을 구분한다. 구형 block은 기존 보수적 fallback을 사용한다.
- metadata에는 안정 ID·의존 관계·실행 순서·안전한 출처·이월 횟수·최초 source 날짜가 포함된다. 같은 날짜 반복 rebuild는 동일 과거 출처에서 계산하므로 횟수가 늘지 않는다. 다음 source 날짜를 거칠 때만 한 번 증가한다. 원본의 로컬 경로는 candidate에 노출하지 않는 기존 계약을 유지한다.
- 이전 일정에서 전부 완료한 선행 작업은 사용자 보고 수준의 completedDependencies로 보존한다. 현재 열린 선행 작업이 다시 유입되면 이전 완료만으로 우회하지 않는다. 명시적 의존 관계는 삭제하지 않는다.
- 오늘 terminal block은 보드에 quest가 없어도 유지하며 완료 항목을 이월 개수에서 제외한다. 폐기는 정확한 workMinutes를 기록·차감한다. 과거 루틴을 이월로 되살리지 않고 현재 날짜의 요일 규칙으로 생성한다. 같은 ID의 현재 source와 이월 source는 한 항목만 만든다.
- 검증: 최종 관련 Node 66개 통과. 공백·빈/손상/날짜 불일치, 75/25분, 여러 날 metadata/횟수, 이전 선행 완료, 오늘 완료/폐기, 요일 루틴·중복 ID, 기존 일정 이동/상태·저장·동시 복구를 포함한다. build·diff 검사 통과. JSX/CSS/화면 구조 변경은 없다.
- 작업 5 및 A04를 관련 검증 범위에서 완료했다. 운영 앱·자료는 변경하지 않았다. 다음은 작업 6 설정 계약이며 작업 6–10과 전체 목표는 active/미완료다.


## 작업 6 완료: 설정 계약 통일

- `settings-contract.js`를 저장·배치·입력 화면의 공통 정본으로 사용한다. 완충시간은 0–30 정수이며 기본값·식사 범위도 함께 관리한다. 구형 09:00–18:00 암묵 설정의 선택 시간 모드 전환은 저장 경계에서 유지한다.
- 수정 전 신규 격리 테스트 세 개에서 31분 이상 저장 허용, 빈 휴식의 점심 재생성, 구형 잘못된 값의 오류 미표시를 재현했다. 수정 후 저장 전 거부와 원본 바이트 보존을 검사했다.
- 명시적 빈 breaks는 식사를 모두 끈 상태로 유지한다. 미지정은 기본 점심을 사용하며 meals가 명시되면 enabled 항목에서 파생한다. 사용자 정의 여러 휴식도 재정규화 후 유지하고 화면에 범위를 표시한다.
- 설정 PUT은 현재 설정을 읽고 새 설정·재배치·활동 기록을 같은 저장 트랜잭션으로 확정한다. 잘못된 새 입력은 400/invalid_settings이며 재배치 오류도 기존 설정을 보존한다. 구형 31–60분 파일은 읽기에서 invalid_settings로 드러내며 전체 유효 설정을 사용자가 저장할 때만 교정한다.
- 화면에서 식사·완충시간을 빠뜨리지 않고 불러온다. 완충시간 입력은 min=0/max=30/step=1이며 시간 한쪽을 지워도 임의 기본값으로 덮어 표시하지 않는다. 저장 실패 시 입력을 유지하고 설정 오류를 표시한다. 안내와 닫기 버튼의 겹침을 해소했다.
- 검증: Node 관련 59개 전체 통과(설정/store/scheduler/manual/inbox/move/storage transaction). 앞선 이월·요청 중복 포함 관련 실행 44개도 통과. 최종 browser smoke 12개 전체 통과: 31분 입력 차단·한쪽 시간 거부·서버 오류와 입력 보존·0/30분 payload·꺼진 식사 유지·구형 오류 GET 후 사용자 교정 저장을 포함한다. 미등록 브리지 요청·pageerror 없음. 새 오류·저장 캡처를 직접 검토했고 닫기 버튼·저녁시간·저장 버튼의 접근을 확인했다.
- 최종 웹 build와 diff 검사 통과. 기존 Tauri 동적/정적 import 묶음 경고는 남아 있으며 전체 JS/JSX 검사 범위 개선은 작업 8에서 수행한다.
- 실제 운영 앱 재시작·설치·자료 이동은 수행하지 않았다. 시험은 fixture와 완전 mock 브라우저만 사용했다. A05/A06은 관련 검증 범위에서 verified다. 작업 7–10 및 전체 목표는 active로 유지한다.


## 작업 7 완료: 실행 식별과 경로 진단

- health에 service/schemaVersion/bridgeVersion/instanceId/startedAt/dataLocationSource/configurationMismatch/profile/handoffState를 추가했다. 버전은 package 버전과 진입 파일 해시이며 전체 저장소 commit 식별을 대신하지 않는다. 재시작 시 instanceId만 새로 생성한다.
- 수정 전 Node fixture health의 식별 필드 부재와 Rust의 임의 TCP listener 승인 실패를 실제 테스트로 확인했다. native 확인은 최대 500ms·16KiB HTTP identity 계약으로 바꿨다. 일반 HTTP·chunked 응답을 검사하며 알 수 없는 listener는 복구 기동에서 오류로 반환하고 자동 종료하지 않는다. 기존 관리 대상 교체도 해당 포트 소유 PID와 같은 스크립트 경로를 함께 확인하도록 제한했다.
- read-only inspectRuntime와 `pnpm diagnose:runtime`를 추가했다. 외부 URL·redirect·oversized 응답을 거부하고 공유 출력은 경로·프로필 원문·일정·인증값을 제외한다. 응답하지 않는 TCP listener, foreign/legacy/incompatible HTTP, 기동되지 않은 상태를 분리한다.
- pointer 우선순위는 유지한다. 실행 중 pointer 변화는 active dataDir을 그대로 둔 채 mismatch로 표시한다. 프로필의 daybridge_root는 코드 실행 경로와 비교하며 저장 경로와 혼동하지 않는다. MARU_ENV_PROFILE 우선 선택 및 루트 표식 확인을 config 발견에 적용했다. 명시적 null/빈 sink는 발견 경로를 비활성화한다.
- profile 미확인, sink 미설정, ready, pending, 실제 delivery_failed/connected를 구분한다. ready와 connected:true 호환 필드는 실제 전달 완료 증거가 아니다. 최근 전달 성공 확인은 현재 데이터·sink에 귀속되고 경로 변경·실패 뒤 승격하지 않는다. 진단은 전달 재시도·잠금 복구·설정 변경을 호출하지 않는다.
- 검증: 최종 Node 관련 26개 통과(진단 8, fixture 3, outbox 7, 요청 영수증 3, 설정 5), Rust 7개 통과, 웹 build·diff 검사 통과. 실제 Windows sink 공유 접근 거부와 새 프로세스 outbox 회귀를 포함한다. 진단은 pointer/profile/config/장애 sink 원본 바이트 보존 및 출력 비노출을 확인했다.
- 실제 운영은 GET health와 포트 소유자·로컬 pointer 비교만 수행했다. 출력은 legacy_bridge/identityVerified=false였고 pointer와 active data 위치 불일치가 현재도 확인됐다. 실제 listener의 실행 명령은 현재 checkout 및 프로필 checkout과 일치했다. 옛 메모의 다른 source 위치를 현재 사실로 재사용하지 않았다. 앱 재시작·실제 설치·자료 이동은 하지 않았다.
- A09는 불일치를 관측·설명하는 진단 범위에서 verified다. 운영 정본 선택과 연결 복구는 operational_path_unresolved로 유지한다. DEBUGGING의 상태 해석과 실행 조건을 갱신했다. UI 구조 변경이 없으므로 화면 검사는 추가하지 않았다.
- 다음은 작업 8: JS/JSX 검사 범위·전체 회귀·좌표 기대값·CI. 작업 8–10 및 전체 목표는 active다.

## 작업 8 완료: 전체 타입·회귀·화면 검사 경로

- 기존 타입 검사에서 실행 JS/JSX가 빠지는 상태를 coverage 회귀로 재현했다. allowJs/checkJs/react-jsx를 적용한 뒤 579줄의 진단을 정리했다. 실제 실행 소스 31개가 검사 대상이며 src의 Node 테스트 파일만 별도 전체 회귀에서 실행한다. 전체 파일 @ts-nocheck나 실행 모듈 제외를 사용하지 않았다.
- 일정·입력·통신·화면 속성·상태·DOM 참조의 계약을 JSDoc와 공통 타입으로 연결했다. 설정 draft의 문자열 입력과 저장된 숫자, 시간 없는 목록과 시간표, nullable 상태를 구분했다. Provider 밖 사용과 누락된 root는 명확한 오류를 낸다.
- 시간 부족으로 unscheduled에 들어간 작업의 metadata가 normalizeSchedule에서 지워지는 추가 결함을 재현했다. 안전한 candidate로 정규화하여 제목·선행 조건·완료한 선행 조건·논리 출처를 보존한다. 일정 생성→JSON 저장/읽기→이월→다음 날짜 배치의 75분 회귀가 수정 후 통과했다. 기존 작업 5의 unscheduled 보존 주장은 이 경로에서 불완전했고 이번에 보완했다.
- scripts/test-all.mjs는 src/scripts의 모든 .test.mjs를 재귀 발견해 순차 실행하고 실패 종료값을 반환한다. 임시 하위 검사에서 실제 실패를 만들어 반환값을 검사했다. Node의 NODE_TEST_CONTEXT 상속 때문에 하위 runner가 실행을 생략하는 문제를 재현·수정했다. 계획상의 run-tests.mjs 대신 역할이 분명한 test-all.mjs를 사용한다.
- Windows 전체 실행에서 20건 동시 durable 저장 검사가 5초 fixture 요청 제한에 걸렸다. 일반 요청과 실제 client의 5초 계약은 유지하고 해당 부하 검사에만 15초 deadline을 지정했다. 수정 후 전체 최종 실행에서 모든 board/schedule/latest 값 보존을 검사했으며 실패를 skip하지 않았다. 첫 실행 중 browser와 겹친 fixture startup 시간 초과는 추가 단독 검사와 최종 순차 실행에서 재발하지 않았다.
- 오래된 좌표 기대값 두 개는 실제 760×720 브라우저 canvas에서 접힘 (472,656,288,64), 3개 카드 펼침 (472,397,288,323)을 확인한 뒤 갱신했다. 설정 720×680과 닫기·저장 접근을 확인했다. native source 추출 검사는 다른 command 추가와 CRLF에도 해당 함수만 읽도록 보완했다.
- 최종 검증: frozen install, pnpm check, 전체 Node 159개/31 suite, pnpm build, offline Rust 7개, 완전 mock browser 13개, diff 검사 통과. 타입 coverage를 포함하며 브라우저 pageerror와 미등록 브리지 요청은 없다. 접힘/펼침 및 설정 저장 캡처를 직접 검토했다. 관련 client와 이월 10개도 마지막 변경 후 통과했다.
- CI 실행 경로는 checkout→고정 Node 24.19.0/pnpm 11.16.0→frozen install→check→test→build→Rust 1.98.1로 구성했다. GitHub actions 참조는 확인한 commit SHA로 고정했다. CI 정의와 로컬 검증을 원격 CI 성공으로 표현하지 않는다.
- 타입 적용 0565e81, 전체 runner/CI 16fd103에 이어 좌표·smoke·기록을 별도 커밋으로 전달한다. 웹 빌드의 기존 Tauri 동적/정적 import 경고는 남아 있고 빌드는 성공했다. 실제 Windows 앱의 모니터·포커스·taskbar를 이번 browser 결과로 승격하지 않는다.
- 작업 8 및 A07은 이 검증 범위에서 verified다. 실제 앱 재시작·설치·운영 자료 이동·Calendar 승인은 수행하지 않았다. 작업 9–10과 전체 목표는 active로 유지한다.

## 작업 9 진행: 독립 브리지 런타임

- 기존 bridge 진입 파일만 임시 폴더에 복사하면 checkout의 상대 모듈 부재로 ERR_MODULE_NOT_FOUND가 발생하는 것을 재현했다. 설치형 앱의 네 단계 상위 폴더 탐색과 시스템 node 의존은 아직 native 연결 작업의 대상이다.
- prepareBridgeRuntime은 명시적인 새 출력 폴더에 Node v24.19.0 Windows x64 실행 파일, googleapis 170.0.0을 포함한 단일 ESM bridge, 최소 package 정보, 고지 파일 및 runtime manifest를 만든다. 기존 출력은 덮어쓰지 않는다. Node 버전·플랫폼·PE 형식, 고정 rolldown 1.2.1과 Node 라이선스 checksum을 확인한다.
- manifest는 실제 포함 npm package의 이름·버전·license와 runtime 파일의 바이트 수·SHA-256을 기록한다. Node의 tagged upstream 고지 원문과 포함 dependency의 실제 고지 파일을 함께 제공한다. data-uri-to-buffer의 MIT 원문은 package README에서 가져온다. 고지 원문이 없으면 실패한다. node_modules 전체, 환경 파일, OAuth 자료와 사용자 데이터는 복사하지 않는다.
- 임시 독립 폴더에서 빈 PATH와 격리 app/data/profile, 임의 포트만 사용해 bundled node 기동·health identity·수동 항목 durable 저장·자기 child 종료·재기동 후 동일 항목과 새 instance 확인을 통과했다. sourceRoot는 패키지 폴더이며 bundle에 개발 저장소 절대 경로가 없음을 확인했다. 실제 운영 브리지와 app은 사용하지 않았다.
- 이 결과는 bridge runtime의 격리 실행 근거다. native resource 선택, 배포 exe 검증 모드, release/NSIS 생성과 실제 설치·로그인 검증은 아직 완료되지 않았다. 작업 9 전체와 A08, 작업 10, 전체 목표는 active로 유지한다.
- 검증: 전체 Node 161개/32 suite, frozen install, pnpm check, pnpm build와 diff 검사 통과. 기존 Tauri 정적/동적 import 경고는 유지된다. 이 변경은 UI와 native 창 동작을 바꾸지 않는다.

## 작업 9 진행: native 리소스 선택과 배포 빌드

- bridge_runtime 모듈의 RuntimeSource와 resolve_bridge_runtime을 native 기동에 연결했다. release는 resource_dir의 bridge-runtime을 선택하며 manifest 버전·플랫폼과 네 파일의 실제 바이트 수·SHA-256을 검사한다. Node와 script 경로도 같은 리소스에서 선택한다. debug에서만 컴파일 시 checkout fallback과 DAYBRIDGE_NODE를 허용한다. 네 단계 부모 폴더 탐색은 제거했다.
- 누락·부분·손상·호환되지 않는 런타임은 오류다. 정상 bundle 선택, release checkout 우회 차단, script 손상, manifest 부재와 다른 Node 버전의 실패를 포함해 Rust 12개 통과했다. 기존 관리 bridge의 교체는 같은 script와 port 소유자 제한을 유지한다.
- pnpm build:widget은 런타임을 준비한 뒤 tauri.release.conf.json을 병합한다. 기본 Tauri 설정은 개발 소스 경로를 계속 사용할 수 있도록 리소스 없이 유지하며 배포 리소스는 별도 설정으로 포함한다. 새 artifact만 생성하는 인터페이스를 유지하고, 재빌드는 이전 inventory·hash·링크 여부를 확인한 생성물만 교체한다. bundling 동안 수정된 내용도 이동 후 다시 검사하고 실패하면 이전 artifact를 복원한다. 미확인 파일과 손상 산출물은 보존한다.
- 첫 release 빌드는 이전 target/release/daybridge.exe의 Windows 접근 거부로 실패했다. 읽기 전용 확인에서 그 실행 파일의 앱 1개가 실행 중이었다. 앱을 종료하지 않고 wrapper의 빌드 대상을 target/package로 분리했다. 수정 뒤 pnpm build:widget --no-bundle이 성공했다. 기존 실행 파일의 hash가 이후에도 동일함을 확인했다. 실패 빌드가 복사한 생성형 리소스 캐시는 기존 target에 남아 있으며 운영 파일로 승격하지 않는다.
- 별도 release 실행 파일과 bridge-runtime을 생성했고, 실제 복사된 네 파일의 hash·길이를 모두 재검사했다. 49개 npm dependency와 고지 파일을 포함한다. renderer 출처의 고지 문서도 runtime notices에 포함한다. 영수증은 Git에서 제외한 test-artifacts/release-resource-inventory.json이며 executableStarted=false, installerVerified=false다.
- 명시적 검증 모드, release exe의 임시 설치 폴더 실행, NSIS 생성·실제 설치·로그인 검증은 미완료다. Windows Sandbox 실행 파일은 없다. 새 배포 exe를 실행하거나 사용자 앱·시작 프로그램·운영 자료·Calendar 권한을 바꾸지 않았다. 작업 9, A08, 작업 10 및 전체 목표는 active다.
- 최종 전체 Node 161개/32 suite(실패·skip 0), Rust 12개, pnpm build:widget --no-bundle의 웹·release 빌드, resource inventory와 diff 검사 통과. 기존 Tauri import 경고는 남아 있다. 원격 CI와 설치본 동작은 이 로컬 검증으로 승격하지 않는다.

## 작업 9 진행: 배포 exe와 NSIS 내부 프로그램 검증

- native 초기 진입에 명시적 `--validate-package` 모드를 추가했다. Tauri UI, Windows 시작 등록, keep-alive보다 먼저 분기하며 새 temp 직계 하위 폴더·32자리 ownership token만 받는다. 환경·프로필·저장 위치를 격리하고 port 0을 사용한다. Windows Job Object는 자기 child bridge만 귀속하고 부모 강제 종료에도 정리한다. 검증 모드의 저장 위치 변경·Calendar 승인 경로·외부 handoff 전달은 차단한다.
- 첫 exe 시험은 실패했다. 추가 진단에서 Rust canonicalize의 Windows verbatim 경로로 인한 Node EISDIR lstat 'C:'를 확인했다. Node 경계에서 드라이브/UNC 경로를 변환하고 Unicode 보존 회귀를 추가했다. 수정 뒤 no-bundle exe 및 NSIS 내부 exe에서 실제 실행이 성공했다.
- `pnpm verify:package`는 검증 marker 없는 기존 exe를 실행 전 거부한다. 새 임시 설치 위치에서 빈 PATH, bundled source, health, 수동 durable 저장, 재기동 후 같은 항목, 저장 경로 이탈·OAuth 거부, 정상 종료, 부모 강제 종료 후 자기 bridge 정리, 시작 등록 값 보존의 10개를 확인했다. 영수증은 ignored `test-artifacts/package-execution.json`이다.
- `pnpm build:widget`이 NSIS 설치 파일 25,898,798 bytes를 생성했다. SHA-256은 `45cfb08015165b2fc9e38882006bdc845455a6e620df2036aa5249bd3f3badb6`이다. `pnpm verify:installer`는 기존 7-Zip으로 12개 inventory를 검증하고 own temp로만 추출한 뒤 실제 포함 exe에서 같은 10개를 통과했다. traversal/중복/필수 파일 누락/타입 거부 검사도 추가했다.
- no-bundle/복원된 빌드 exe hash는 `55733967e5a94f99b509316599fbf29a00d409d5b2bdf58c4425defae8ccc326`, NSIS payload exe hash는 `783df544214e748564456ca5980eff808b96047991c38b6d84ed4f382eb36bc1`이다. 별도 추출 비교에서 같은 길이 9,267,712 bytes 중 Tauri bundle-type marker의 UNK→NSS 3bytes만 달랐다. Tauri bundler의 stamping/restore 소스와 일치한다. 서로 다른 hash를 같은 파일로 기록하지 않는다.
- installer receipt는 `payload_verified`, `installationExecuted=false`, `loginVerified=false`, `installerVerified=false`를 유지한다. 실제 NSIS 설치·설치 후 UI/tray/로그인·삭제 검증은 수행하지 않았다. Windows Sandbox나 기존 test VM 환경을 확보하지 못했다. 운영 앱·자료 정본·시작 설정·Calendar 승인은 변경하지 않았다. 기존 운영 exe hash는 다시 확인했고 변함없었다.
- Rust 16개, strict check, release/웹/NSIS build, payload 검증이 통과했다. Windows CI에 격리 release build와 exe verification을 추가했으며 원격 CI 실행은 미확인이다. 최종 전체 Node는 162개/33 file, fail/skip 0으로 통과했다.
- 첫 전체 Node 실행에는 fixture startup timeout과 cross-process lock open EPERM이 있었다. 원인 확정 없이 production retry나 timeout을 바꾸지 않았다. 관련 16개 단독 및 전체 162개 재실행은 통과했다. 이 간헐 실패는 미해결 관찰로 남긴다. 재실행 성공을 원인 해결로 표현하지 않는다.

## 작업 10 진행: 현재 동작과 감사 대응표

README·ARCHITECTURE·DEBUGGING·PROJECT_STATUS의 현재 checkpoint를 코드에 맞췄다. 현재 닫기=명시적 종료, 18:00 자동 종료 부재, daily supplement 기본 루틴, release resource 경로, 전체 strict 검사, DPAPI 암호화 token file, 저장 journal/idempotency/outbox, 운영 불일치의 진단 범위, 실제 설치 미검증을 명시했다. 과거 worklog와 프로젝트 상태의 역사 부분은 보존한다.

| 감사 | status | evidence | verification | remaining |
|---|---|---|---|---|
| A01 웹 요청 변경 | verified | HTTP policy / 작업 2 / 15f2903 | 거부 요청 상태·event 보존 회귀, 전체 162개 | 정상 허용 origin 사용 유지 |
| A02 동시 저장 손실 | verified | date transaction / 작업 3 / a653633·60e0cb9 | 20개 보존·교차 프로세스·compiler 공동 잠금 회귀 | 이번 최초 실행 EPERM 간헐 원인 조사 |
| A03 실제 자료 시험 접근 | verified | fixture isolation / 작업 1 / 15f2903 | parent profile/pointer 무시, own temp/port, mock browser | 운영 자료는 시험 대상 아님 |
| A04 공백 이월 | verified | carryover / 작업 5 / 04ae562·8fbab42 | 공백·빈 source·손상·완료/폐기·metadata 회귀 | 운영 앱에는 미적용 |
| A05 휴식 비활성 | verified | settings contract / 작업 6 / 9c42f7b | empty breaks 보존·mock 화면 13개 범위 | 운영 앱에는 미적용 |
| A06 설정 범위 불일치 | verified | settings contract / 작업 6 / 9c42f7b | store/scheduler/UI 0–30·오류 원본 보존 | 운영 앱에는 미적용 |
| A07 검사 공백 | verified | strict coverage+runner / 작업 8 / 0565e81·16fd103·c9f7184 | src 31개 strict·전체162·Rust16·기존 browser13 | 원격 CI 결과, startup timeout 관찰 조사 |
| A08 독립 설치 불가 | open | bundle/resource / 작업 9 / 36573bd·ed78ad3 및 이번 checkpoint | exe와 실제 NSIS payload의 10개 격리 실행 통과 | 실제 NSIS 설치·로그인·삭제 미검증 |
| A09 경로 불일치 | verified | runtime identity/inspect / 작업 0·7 / 9b62109 | 읽기 전용 불일치 진단·파일 보존 | operational_path_unresolved, 정본 선택·복구 별도 |
| A10 중복/부분 실패 | verified | stable request/receipt/outbox / 작업 4 / 7f86ded·7ad6e62·3a48f28·8f3de7c | 재시도 중복0·재기동 전달·잠금된 sink 실패 회귀 | 실제 운영 sink 전달 별도 |
| A11 손상 덮어쓰기 | verified | strict JSON/journal / 작업 3 / e29abc3·a653633 | 원본 byte 보존·준비 journal 복구·탈출 차단 | 실제 손상 자료 자동 교정 없음 |
| A12 낡은 설명 | fixed | 위 4개 문서와 현재 checkpoint / 작업 10 | 소스·receipt와 대조, 과거 기록 보존 | 이번 commit/push·MARU 종료 기록 확인 |

목표는 active다. 작업 0–8 완료와 작업 9/10 진행은 실제 설치 검증 완료를 대신하지 않는다. 다음은 간헐 잠금/startup 오류의 재현·관측과 격리 Windows 설치 시험 환경 확보다.

## 원격 CI 연속 실패 정정: Rust 의존성 drift

- 사용자가 연속 배포 실패와 HWND 충돌을 지적했다. 이전 체크포인트의 로컬 검증은 실제였지만 원격 CI를 확인하지 않은 채 다음 작업으로 진행한 판단은 불충분했다.
- GitHub Actions 36819102465, 36820546687, 36822352837, 36826004950의 job/log를 직접 확인했다. 웹 검사와 전체 Node 회귀는 성공했고 native regression에서 실패했다. 공통으로 Tauri 2.12.1/windows 0.62.2의 HWND를 앱 windows 0.61.3 함수에 전달해 E0308 9개가 발생했다. 최신 실행에는 Job Object의 Threading feature 누락 E0433도 있었다.
- 로컬 Cargo.lock은 Tauri 2.11.5/tauri-build 2.6.3/windows 0.61.3이며 Git ignore라 clean CI에 전달되지 않았다. 광범위 version=2가 CI에서 새 graph를 선택해 로컬 결과와 달랐다. 잠금 파일을 추적하고 직접 세 버전을 정확히 고정했다. native regression 및 release wrapper는 --locked로 잠금 변경을 거부한다. JobObjects의 Threading feature도 직접 선언해 다른 dependency feature에 기대지 않는다.
- locked Rust 16개와 --locked release build가 통과했다. 원격 수정본 실행 결과는 별도 확인하며 로컬 성공을 원격 성공으로 대체하지 않는다. 실제 NSIS 설치·로그인 미검증 범위는 유지한다.

## 현재 Windows 설치 검증과 잠금 경합 재현

- 사용자가 VM 제거와 현재 Windows에서의 시험을 승인했다. VMware 등록을 해제했고, 영구 삭제가 자동 승인 정책에 차단된 뒤 검증 VM 폴더를 휴지통으로 이동했다. VM은 실행하지 않았으며 Windows를 설치하지 않았다.
- 기존 위젯을 잠시 종료하고 NSIS를 새 테스트 폴더에 실제 설치했다. 설치 등록 경로가 fixture 내부임을 확인했다. 설치/삭제 종료 코드는 모두 0이다. 설치된 payload의 10개 격리 실행 검사도 통과했다. 설치 파일 SHA256: E71AB1AE25CFDAFF219EE3AD8DA2F9D50ED808670AE22BC36D96572B07808192. 설치 payload exe SHA256: 25b034515baf981efc3b4479013ce87153a033222a2d3a21e606ce67604ea375.
- `/NS`로 바로가기를 만들지 않았고 삭제에 `/UPDATE`를 사용해 기존 자동 실행 값을 보존했다. own fixture로 확인한 잔여 product registry만 정리했다. 원래 exe hash와 Run 값은 동일하며 원래 위젯 실행을 다시 확인했다. native 검증 모드의 bridge 재기동은 정상 UI/tray 또는 실제 Windows 로그인 시험을 대신하지 않는다. 로컬 영수증: ignored `test-artifacts/host-installer-execution.json`, `package-execution.json`.
- 위젯 복구 시 기존 앱이 bridge를 다시 시작했다. 재시작 전 legacy bridge의 dataDir와 기존 저장 pointer가 달랐다. 재시작 후 schemaVersion=1 식별과 pointer 선택을 확인했다. pointer를 수정하거나 데이터를 이동하지 않았다. 이전 실행 경로의 자료도 삭제하지 않았다.
- exclusive lock creation의 Windows EPERM을 실제 transaction stress에서 수정 전 재현했다. wx 생성만 기존 2초 범위에서 EPERM/EACCES/EBUSY를 재시도한다. write/sync/owner 오류는 숨기지 않는다. 실제 지속 접근 거부는 약 2010ms에 실패하고 원본을 보존했다.
- 새 3-process/450-acquisition 시험을 포함한 첫 전체 실행은 163개 중 162개 통과, 1개 실패였다. 실패는 EPERM이 아닌 정상적인 2초 `storage_conflict`다. stress worker는 그 busy conflict만 전체 25초 한도 내에서 다시 요청한다. lock ownership 변경·접근 실패 등 다른 오류는 그대로 실패한다. 제품의 잠금 대기 한도는 늘리지 않았다.
- 원격 HWND 수정 실행 36826782515는 native/배포/패키지 검사를 포함해 success다. 이번 변경의 원격 실행과 전체 재검사 결과는 별도로 확인한다.
- A02: wx 생성 실패 보완 및 반복 경합 검증 진행. A07: fixture startup timeout은 미재현 관찰로 유지. A08: 실제 설치/삭제와 payload 실행 확인, 정상 설치 UI/tray·Windows 로그인은 open. A12: DEBUGGING의 잔여 18:00 종료·checkout 의존·전달 완료 오인 설명을 바로잡았다. 전체 목표는 active다.

- 최종 전체 재검사: Node 163개/33 files, pass163/fail0/skip0, 177323ms. 수정된 경합 worker로 450건 전체 획득을 확인했다. 현재 Windows 설치·삭제·원래 위젯 실행·시작 설정 보존·fixture registry 제거와 VM 원래 폴더/목록 제거를 재확인했다.
