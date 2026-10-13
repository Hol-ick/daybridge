# 큰 메모 통합 뒤 작은 창 중복 수정: 2026-10-13

사용자는 큰 창이 정상 표시되지만 예전 작은 창도 같이 나와 입력을 방해한다고 보고했다. 실제 앱 프로세스는 설치본 하나였다. 단축키 show를 archive로 바꾼 뒤에도 native config에 memo360×360이 남아 preloaded됐고, legacy MemoSurface의 window focus handler가 begin/show를 호출할 수 있는 구조였다. 단축키 전달만 바꾸고 기존 surface 생성을 제거하지 않은 누락이다.

native config의 memo 창과 해당 capability를 제거했다. 저장/보관/release caller는 archive만 허용한다. native CloseRequested도 archive만 담당한다. 작은 preview 컴포넌트의 native 독립 focus는 막고 브라우저 회귀용 preview는 유지한다. 배포 surface가 archive/dashboard/overlay뿐이고 큰 archive 규격과 권한이 유지되는 설정 계약 검사를 추가했다.

타입/새 native surface 계약 검사1개·Rust41개 통과. 작은 창을 임시로 숨기는 조치가 아니라 생성과 caller 경로를 제거했다. Windows 패키지/운영 설치 및 사용자 중복 해소 확인은 후속 근거로 남긴다. 활성 draft가 있으면 강제로 종료하지 않는다.
