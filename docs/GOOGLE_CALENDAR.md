# Google Calendar 연결

Daybridge는 Google Calendar에 **읽기 전용**으로 연결한다. 일정의 제목, 설명, 참석자, 장소, 링크는 요청·표시·저장하지 않는다. 시간표에는 “바쁜 시작·종료 시각”만 익명 일정 블록으로 반영된다.

## 한 번만 준비할 것

Daybridge는 아직 개인용 Google OAuth 클라이언트를 사용한다. Google Cloud Console에서 다음을 준비한다.

1. Google Calendar API를 사용 설정한다.
2. OAuth 동의 화면에 자신의 Google 계정을 테스트 사용자로 추가한다.
3. **웹 애플리케이션** OAuth 클라이언트를 만들고, 승인된 리디렉션 URI로 아래 주소를 정확히 추가한다.

   ```text
   http://127.0.0.1:39393/api/calendar/oauth/callback
   ```

4. 내려받은 클라이언트 JSON의 이름을 `google-oauth-client.json`으로 바꾼다.
5. 아래 개인 컴퓨터 전용 폴더에 둔다. Git 저장소나 AIHUB 폴더에는 넣지 않는다.

   ```text
   %LOCALAPPDATA%\Daybridge\google-oauth-client.json
   ```

## 연결하기

1. Daybridge 브리지와 대시보드를 실행한다.
2. 대시보드 오른쪽 위 **캘린더**를 누른다.
3. 열린 Google 창에서 권한을 승인한다.
4. 완료 창이 보이면 닫는다. 이후 **재배치**를 누르면 바쁜 시간이 시간표에 반영된다.

Google은 이 작업에서 `calendar.readonly` 권한만 요청한다. Daybridge에는 캘린더 일정 생성·수정·삭제 API가 없다.

## 로컬 보관 경계

- OAuth client JSON은 이 Windows 사용자 기기의 `%LOCALAPPDATA%\Daybridge`에만 있다.
- OAuth refresh token은 Windows DPAPI로 현재 Windows 사용자에게만 복호화 가능한 `google-calendar-token.dpapi` 파일로 보관한다.
- OAuth token, client secret, 인증 코드, 일정 원문은 Daybridge UI 응답·일정 저장본·AIHUB handoff에 기록되지 않는다.
- 연결을 해제하려면 `%LOCALAPPDATA%\Daybridge\google-calendar-token.dpapi`만 삭제한 뒤 브리지를 다시 시작한다. 이 파일은 로컬 암호문이며 휴지통으로 이동해도 된다.
