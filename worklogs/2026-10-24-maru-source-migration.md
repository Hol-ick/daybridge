# MARU 소스 통합 — 2026-10-24

실제 개발 소스와 기존 MARU 자료를 Daybridge 프로젝트에 통합했다. 기존 변경·설정·메모 저장 위치와 설치된 앱은 보존했으며, 환경 프로필의 개발 소스 경로를 MARU 프로젝트로 전환했다.

pnpm 11의 설정 계약에 맞춰 `pnpm-workspace.yaml`에서 `nodeLinker: hoisted`와 `packageImportMethod: copy`를 사용한다. 의존성을 일반 파일로 설치하여 Drive에서 링크 생성 오류를 피한다. 타입 검사, 컴파일러 테스트 8개와 웹 빌드를 통과했다.

이동 전 소스·Git·설정과 최종 설치 파일은 `MARU:/04_Operations_And_Automation/Maintenance/project-migration-20261023/`에 검증된 보존본으로 남겼다. 이전 MARU 상태 문서는 같은 위치의 `canonical-before/Daybridge/PROJECT_STATUS.md`에서 확인할 수 있다.

로컬 원본 삭제는 자동 승인 검토의 정책 차단으로 실행되지 않았다. 설치된 앱의 bridge-runtime과 개발 체크아웃을 구분하며, 기존 메모 저장 위치는 변경하지 않았다. 설치 런타임의 profile_checkout_mismatch는 이관 전부터 관찰된 상태다.
