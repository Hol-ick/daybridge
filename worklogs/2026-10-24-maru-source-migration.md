# MARU 소스 통합 — 2026-10-24

실제 개발 소스와 기존 MARU 자료를 Daybridge 프로젝트에 통합했다. 기존 변경·설정·메모와 설치된 앱을 보존했으며, 환경 프로필의 개발 소스 경로를 MARU 프로젝트로 전환했다.

pnpm 11의 설정 계약에 맞춰 `pnpm-workspace.yaml`에서 `nodeLinker: hoisted`와 `packageImportMethod: copy`를 사용한다. 의존성을 일반 파일로 설치하여 Drive에서 링크 생성 오류를 피한다. 타입 검사, 컴파일러 테스트 8개와 웹 빌드를 통과했다.

이동 전 소스·Git·설정과 최종 설치 파일은 `MARU:/04_Operations_And_Automation/Maintenance/project-migration-20261023/`에 검증된 보존본으로 남겼다. 이전 MARU 상태 문서는 같은 위치의 `canonical-before/Daybridge/PROJECT_STATUS.md`에서 확인할 수 있다.

운영 데이터 186개 파일은 별도 ZIP과 SHA-256으로 보존하고 .runtime-data/에 복사한 뒤 앱이 지원하는 저장 위치 API로 전환했다. 상태 응답은 새 데이터 경로 및 ok를 확인했다. 일정 조회는 3개 블록을 반환했고 실제 웹 화면을 확인했다. 개인 데이터 폴더는 Git에서 제외했다. 영구 삭제가 정책 차단된 뒤 검증된 두 로컬 Daybridge 원본은 휴지통으로 옮겨 복구 가능하게 정리했다. 설치된 앱의 bridge-runtime과 개발 체크아웃은 구분한다. 설치 런타임의 profile_checkout_mismatch는 이관 전부터 관찰된 상태다.
