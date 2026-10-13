# 재시작 시 구버전 실행 경로 차단: 2026-10-13

운영 설치본은 최신5c2bf51 해시였으나 로컬 로그의10월6일/13일 watchdog 시작 경로와 공유 watchdog 스크립트는9월23일 target/release 구버전을 가리켰다. Run과 시작 메뉴는 조사 시점에 최신 설치 경로였다. 옛 파일을 최초로 호출한 외부 주체까지 확인한 것은 아니며, 구버전 실행 및 재실행 경로를 확인한 근거와 구분한다.

모든 release 실행이 current_exe를 Run에 쓰고 같은 감시자 스크립트를 덮는 구조를 수정했다. 제거 등록 InstallLocation과 실제 설치 파일을 기준으로 실행 역할을 결정한다. 다른 경로의 release는 설치본으로 전달 후 종료하며, 등록 없는 standalone/debug는 Run/keepalive를 소유하지 않는다. Windows 세션 단일 앱 mutex는 중복 실행의 bridge/단축키 경쟁을 막는다. 감시자는 Run 소유권 변경 시 종료한다. app_started에는 빌드 revision과 startupOwner를 기록한다. 검증 모드는 이 경로보다 먼저 실행돼 운영을 건드리지 않는다.

타입/전체 Node191개, Rust39개 통과. Windows 패키지·독립 payload·운영 적용 및 실제 옛 경로/중복/프로세스 복구 검증은 후속 작업이다. 메모·일정·설정·저장 위치와 기존 미추적 worklog 둘을 보존한다. 운영 변경 전 비공개 EXE/메모/native/Run/저장 포인터 백업을 준비했다. 구버전 파일은 백업 후 같은 경로에 새 라우팅 가능한 실행 파일을 두어 옛 경로를 호출하는 주체도 정본으로 연결할 예정이다. 재부팅·로그아웃 없이 검증하며 실제 다음 Windows 로그인 관찰을 수행한 것으로 보고하지 않는다.

운영 검증에서 오늘 구버전이 실행한 checkout Node 브리지도 orphan으로 남아 있었다. listener PID·정확한 script/node 경로·구버전 시작 시각과 Daybridge health를 대조해 특정 프로세스만 종료하고 설치본 watchdog의 bundled 복구를 확인한다. release가 unmanaged 경로의 브리지를 그대로 정상 수용하던 경로는 오류로 처리하도록 보완했다. foreign service는 종료하지 않으며 debug의 기존 연결은 유지한다. 최종 수정의 Rust39개 재검사 통과.
