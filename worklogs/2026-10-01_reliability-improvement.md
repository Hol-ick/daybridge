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
