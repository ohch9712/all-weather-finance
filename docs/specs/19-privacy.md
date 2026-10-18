# 19. 개인정보 처리방침, 회원 탈퇴, 만 14세 확인

> 웨이브 6 · 브랜치 `feature/19-privacy` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 1~5웨이브 병합(develop). 사용자 결정(2026-10-18): 회원 탈퇴 기능을 함께 만든다. 국외 이전(Google Gemini)을 거부하면 AI 기능을 쓸 수 없다고 안내하며, 사용자별 AI 끄기 설정은 만들지 않는다.
> 7절 처리방침 문구는 코디네이터가 개인정보보호위원회 「개인정보 처리방침 작성지침」(2024-04 개정)의 필수 항목, 개인정보 보호법 제28조의8(국외 이전), CODEF 위탁 안내(https://codef.io/privacy-pop), Gemini API 추가 약관(https://ai.google.dev/gemini-api/terms, 유료 서비스)과 이 앱의 실제 보관 값(세션 7일, 업로드 표 24시간, 로그 10MB×3, 백업 7일)을 확인해 쓴 원안이다. 다른 사람에게 가입을 열기 전에 운영자가 법률 검토를 받는 것을 권한다(README "공개 전 확인").

## 1. 목표

- 로그인 없이 볼 수 있는 `/privacy` 화면에 개인정보 처리방침을 공개한다. 운영자·보호책임자 정보는 저장소가 아니라 서버 환경변수에서 읽는다(공개 저장소에 개인 연락처를 넣지 않는다).
- 이용자가 직접 계정과 모든 데이터를 지울 수 있는 회원 탈퇴를 만든다. CODEF 연결은 CODEF에서 먼저 지운다.
- 만 14세 미만은 가입·이용하지 않도록 가입 화면에서 확인하고, 출생연도로 서버에서도 막는다.

## 2. 범위

### 포함

- `/privacy` 공개 화면(7절 문구), 가입·로그인 화면과 계정 화면의 링크
- `DELETE /api/auth/me`(비밀번호 확인 후 계정 삭제), `connectors.delete_all_accounts` 공개 함수
- `/settings/account` 화면(계정 정보, 처리방침 링크, 계정 삭제), 내비게이션 "계정" 항목
- 가입 화면 "만 14세 이상입니다" 필수 확인, 프로필 출생연도 만 14세 검사
- 배포 설정: 프론트 컨테이너에 `PRIVACY_*` 환경변수 전달, Caddy 시도 제한에 계정 삭제 요청 추가, README 갱신

### 제외

- 사용자별 AI 처리 끄기 설정, 이용약관(서비스 약관) 문서, 처리방침 이전 버전 보관 화면, 비밀번호 재설정

## 3. 소유 파일

- 백엔드: `backend/app/modules/auth/**`(라우터·서비스·스키마), `backend/app/modules/connectors/service.py`(공개 함수 `delete_all_accounts` 추가만), `backend/tests/auth/**`, `backend/tests/connectors/test_delete_all_accounts.py`
- 프론트: `frontend/src/app/privacy/**`(새 공개 경로, 앱 셸 밖), `frontend/src/app/(app)/settings/account/**`, `frontend/src/app/(auth)/layout.tsx`(아래쪽 처리방침 링크만), `frontend/src/features/auth/**`, `frontend/src/features/privacy/**`, `frontend/src/lib/navigation.ts`("계정" 항목 한 줄만), `frontend/tests/privacy/**`, `frontend/tests/auth/**`, `frontend/tests/foundation/auth-forms.test.tsx`(가입 제출 전에 만 14세 체크박스를 누르는 줄만), `frontend/tests/foundation/navigation.test.tsx`("계정" 항목 한 줄만)(코디네이터 승인 2026-10-19)
- 배포: `deploy/compose.prod.yaml`(frontend 서비스 환경변수만), `deploy/.env.production.example`(`PRIVACY_*` 키 추가), `deploy/Caddyfile`(시도 제한 대상 추가만), `deploy/README.md`(운영자 정보 넣기, 공개 전 확인 갱신)
- 이 문서의 `## 구현 결과`

## 4. API 계약

| 메서드·경로 | 성공 |
| --- | --- |
| `DELETE /api/auth/me` | `204`. 세션 쿠키를 지운다(로그아웃과 같은 `clear_session_cookie`) |

- 요청: `{"password": "…"}`(`require_json`, 인증 필요). 비밀번호는 로그·예외·응답에 남기지 않는다.
- 비밀번호가 비었거나 틀리면 `422 VALIDATION_ERROR`(`field_error("password", "비밀번호가 맞지 않습니다.")`).
- 이 사용자가 `role == "admin"`이고 다른 관리자가 없으면 `409 CONFLICT`("마지막 관리자 계정은 삭제할 수 없습니다. 다른 관리자를 먼저 지정해 주세요.").
- 처리 순서: 비밀번호 확인 → 마지막 관리자 확인 → `connectors.delete_all_accounts(db, user_id)` → `users` 행 삭제(다른 모든 사용자 테이블은 FK `ON DELETE CASCADE`, `posts.author_id`는 `SET NULL`) → commit → 쿠키 삭제.
- `connectors.delete_all_accounts`가 실패하면 `users` 행을 지우지 않고 `409 CONFLICT`("CODEF 연결을 지우지 못했습니다. 데이터 자동 수집 화면에서 연결을 먼저 삭제해 주세요.")를 돌려준다. 이미 CODEF에서 지운 연결은 그 시점에 지워진 채로 남는다(다시 시도하면 남은 연결만 처리한다).

### 4.1 `connectors.delete_all_accounts` (architecture 8절에 추가)

```python
# app/modules/connectors/service.py  (17, 19)
def delete_all_accounts(db, user_id) -> None
```

- 사용자의 `connector_accounts`를 만든 순서대로 하나씩 기존 `delete_account(db, user_id, account_id)`(기본 삭제: CODEF 성공 뒤에만 행·현금 자산 삭제, 스펙 17 7절)와 같은 규칙으로 지운다. 한 연결이 끝날 때마다 commit해서 다시 시도할 때 남은 연결만 처리되게 한다.
- 어느 연결에서든 CODEF 삭제가 실패하거나(`502 CONNECTOR_FAILED`) 키가 없으면(`409 CONFLICT`) `AppError(409, "CONFLICT", "CODEF 연결을 지우지 못했습니다. 데이터 자동 수집 화면에서 연결을 먼저 삭제해 주세요.")`로 멈춘다. 연결이 없으면 아무것도 하지 않는다.
- 로그에는 고정 문구와 형식이 검증된 CODEF 결과 코드만 남긴다.

### 4.2 출생연도 만 14세 검사

- `PUT /api/profile`의 `birthYear`가 있으면 `올해(KST) − birthYear >= 14`여야 한다. 아니면 `422 VALIDATION_ERROR`(`field_error("birthYear", "만 14세 이상만 이용할 수 있습니다.")`). 기존 범위 검사(1900~2100)는 그대로 둔다.
- 기존 테스트·시드가 쓰는 출생연도가 이 검사에 걸리면 그 테스트 값을 고친다(다른 모듈 테스트 파일이면 `ask`로 묻는다).

## 5. 화면 명세

### 5.1 `/privacy` (공개, 로그인 불필요)

- 앱 셸 밖의 단독 화면. 위에 서비스 이름(`APP_NAME`) 링크, 제목 "개인정보 처리방침", 시행일. 본문은 7절 문구를 글자 그대로 쓰고 표는 표로 보여 준다. 360px에서 표는 표 영역 안에서만 가로 스크롤하고 페이지 전체는 가로로 넘치지 않는다. 인쇄해도 읽을 수 있게 한다.
- 7절의 `{운영자}`·`{보호책임자}`·`{연락 이메일}`·`{호스팅 업체}`·`{시행일}`은 프론트 서버의 런타임 환경변수 `PRIVACY_OPERATOR_NAME`·`PRIVACY_OFFICER_NAME`·`PRIVACY_CONTACT_EMAIL`·`PRIVACY_HOSTING_PROVIDER`·`PRIVACY_EFFECTIVE_DATE`(`YYYY-MM-DD`)에서 요청 때 읽는다(서버 컴포넌트, 빌드에 굳히지 않는다. Next.js 16 문서에서 요청 시 렌더링 방법을 확인한다). 이 값들은 브라우저 번들에 넣지 않는다(`NEXT_PUBLIC_` 금지).
- 값이 하나라도 비면 본문 위에 경고 상자 "운영자 정보가 아직 설정되지 않았습니다. 이 처리방침은 공개 전 초안입니다."를 보여 주고, 빈 자리는 "(미설정)"으로 쓴다.
- 이메일은 `mailto:` 링크. 외부 링크는 `target="_blank"`, `rel="noopener noreferrer"`.

### 5.2 링크

- `(auth)/layout.tsx`: 본문 아래 작은 글씨 링크 "개인정보 처리방침"(`/privacy`).
- 가입 폼(`SignupForm`): 제출 버튼 위에 필수 체크박스 "만 14세 이상입니다."(체크하지 않으면 "만 14세 이상만 가입할 수 있습니다.")와 안내 "가입하면 개인정보 처리방침에 따라 개인정보가 처리됩니다."(‘개인정보 처리방침’은 새 창 링크). 체크 값은 서버로 보내지 않는다(서버 검사는 4.2).
- 내비게이션 설정 그룹에 "계정"(`/settings/account`, 기존 아이콘 세트에서 고른다)을 "프로필" 다음에 둔다.

### 5.3 `/settings/account`

- 제목 "계정". 카드 1 "계정 정보": 이메일, "개인정보 처리방침 보기" 링크.
- 카드 2 "계정 삭제"(위험 영역 스타일). 안내 목록:
  1. `계정을 삭제하면 자산·가계부·매매일지·가족·증여 기록·관심종목·조건검색·챗봇 대화·연결 정보가 모두 지워지고 되돌릴 수 없습니다.`
  2. `CODEF 연결이 있으면 CODEF에 등록된 로그인 정보부터 지웁니다. 지우지 못하면 계정 삭제를 멈춥니다.`
  3. `증권사 앱키는 이 앱에서 지워도 증권사에는 발급된 상태로 남습니다. 필요하면 증권사 포털에서 해지해 주세요.`
  4. `서버 백업에는 최대 7일 동안 남았다가 지워집니다.`
- 비밀번호 입력(`autoComplete="current-password"`)과 빨간 "계정 삭제" 버튼 → 확인 창(제목 "정말 계정을 삭제할까요?", 설명 "이 작업은 되돌릴 수 없습니다.", 확인 버튼 "계정 삭제", destructive) → `DELETE /api/auth/me`.
- 성공: 쿼리 캐시를 비우고 인증 상태를 로그아웃으로 바꾼 뒤 `/login?deleted=1`로 이동한다. 로그인 화면은 `deleted=1`이면 "계정을 삭제했습니다."를 한 번 보여 준다.
- `422`는 비밀번호 칸 아래에 메시지. `409`의 CODEF 메시지면 메시지 아래 "데이터 자동 수집으로 이동"(`/settings/connections`) 링크를 보여 준다. 그 밖의 `409`·오류는 메시지만. 실패하면 비밀번호 칸을 비운다.

## 6. 배포 설정

- `deploy/.env.production.example`에 `PRIVACY_OPERATOR_NAME=`, `PRIVACY_OFFICER_NAME=`, `PRIVACY_CONTACT_EMAIL=`, `PRIVACY_HOSTING_PROVIDER=`, `PRIVACY_EFFECTIVE_DATE=`(값 없음)를 더하고, `compose.prod.yaml`의 `frontend` 서비스 런타임 환경에 이 다섯 개만 넘긴다.
- `deploy/Caddyfile`의 IP별 시도 제한에 `DELETE /api/auth/me`를 더한다(로그인·가입과 같은 10분 10회).
- `deploy/README.md`: 운영자 정보 다섯 값 넣는 법, `/privacy` 확인, "공개 전 확인"에 법률 검토 권장·시행일 확인·호스팅 업체 이름 확인을 적는다.

## 7. 처리방침 문구 (원안)

`{…}`는 5.1의 환경변수 값이다. 표는 표로, 목록은 목록으로 보여 준다.

---

**개인정보 처리방침**

시행일: {시행일}

{운영자}(이하 "운영자")는 개인 자산배분·가계부·매매일지·상속증여 참고 서비스(이하 "서비스")를 운영하면서 「개인정보 보호법」에 따라 이용자의 개인정보를 보호하고 관련 고충을 신속하게 처리하기 위해 다음과 같이 개인정보 처리방침을 둡니다.

**1. 개인정보의 처리 목적**

운영자는 다음 목적으로만 개인정보를 처리하며, 목적이 바뀌면 미리 알리고 필요한 조치를 합니다.

1. 회원 가입과 관리: 본인 계정 식별, 로그인 유지, 부정 이용 방지(로그인 시도 제한)
2. 서비스 제공: 나이대·투자성향에 맞는 권장 자산배분과 점수, 가계부·매매일지 기록과 통계, 상속·증여 세금 참고 계산, 관심종목·조건검색, 학습 게시판 북마크
3. 데이터 연결: 이용자가 직접 연결한 증권사(키움증권·토스증권)의 잔고·체결 조회, CODEF를 통한 카드 승인내역·은행 계좌 잔액 조회
4. AI 기능: 가계부 가맹점 자동 분류, 업로드 파일의 열 인식, 카드 명세서 AI 추출, AI 챗봇 답변

**2. 처리하는 개인정보 항목**

| 구분 | 항목 |
| --- | --- |
| 회원 가입(필수) | 이메일, 비밀번호(복호화할 수 없는 해시로만 저장) |
| 프로필 | 출생연도, 닉네임 |
| 이용자가 입력하거나 올린 정보 | 투자성향 설문 답변, 보유 자산(이름·금액·메모), 월 지출·부양가족 수·소비성 부채, 재무 목표, 가계부 내역(날짜·금액·가맹점·카드명·승인번호·메모), 매매 기록과 메모, 가족 정보(관계·표시 이름·생년월일·혼인일·자녀 출생일)와 증여 기록, 관심종목, 저장한 조건검색, AI 챗봇 대화, 업로드한 파일에서 읽은 표 내용 |
| 연결 정보(선택) | 증권사 앱키·시크릿·계좌번호(암호화 저장, 화면에는 끝 4자리만 표시), CODEF 연결 식별값(암호화 저장)과 가져온 카드 승인내역·계좌 잔액. 계좌번호 원문과 금융사 아이디·비밀번호는 이 서비스에 저장하지 않습니다 |
| 자동으로 생성·수집되는 정보 | 로그인 세션 쿠키, 접속 IP·요청 시각·요청 경로(서버 로그) |

업로드한 파일의 원본은 저장하지 않습니다. 파일에서 읽은 표 내용은 확인·저장 단계를 위해 24시간 동안만 보관합니다.

**3. 개인정보의 처리 및 보유 기간**

| 항목 | 보유 기간 |
| --- | --- |
| 회원 정보와 이용자가 입력·연결한 정보 | 회원 탈퇴(계정 삭제) 시까지. 각 화면에서 지우면 그때 삭제 |
| 로그인 세션 | 로그인 후 7일 또는 로그아웃할 때까지 |
| 업로드 파일에서 읽은 표 내용 | 업로드 후 24시간 |
| 서버 로그 | 용량 기준으로 순환 삭제(서비스별 최대 30MB) |
| 데이터베이스 백업 | 매일 만들고 7일 뒤 삭제. 탈퇴한 이용자의 정보도 백업에는 최대 7일 남았다가 삭제 |

**4. 개인정보의 파기 절차 및 방법**

보유 기간이 끝나거나 이용자가 탈퇴하면 지체 없이 파기합니다. 데이터베이스의 정보는 복구할 수 없게 삭제하고, 백업 파일은 보관 기간이 지나면 삭제합니다.

**5. 개인정보의 제3자 제공**

운영자는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 이용자가 증권사 연결을 등록하면 이용자가 발급한 앱키로 해당 증권사에 잔고·체결 조회를 요청합니다.

**6. 개인정보 처리의 위탁**

| 수탁자 | 위탁 업무 |
| --- | --- |
| (주)헥토데이터(CODEF) | 이용자가 CODEF 연결을 등록한 경우: 금융사 인증 정보를 이용한 카드 승인내역·계좌 잔액 조회 중계, API 서비스 품질 향상과 업무 대응을 위한 요청·응답 데이터 저장(위탁 계약 종료 시 일괄 삭제), 정보주체의 열람·정정·삭제·처리정지 요청 처리 |
| Google(Gemini API 유료 서비스) | AI 기능 처리(7. 개인정보의 국외 이전) |
| {호스팅 업체} | 서비스 서버와 데이터베이스 운영(대한민국 서울 리전) |

위탁 기간은 회원 탈퇴 시 또는 위탁 계약 종료 시까지입니다.

**7. 개인정보의 국외 이전**

AI 기능은 Google의 Gemini API로 처리합니다. 서비스 이용 계약을 이행하기 위해 필요한 처리위탁으로서 「개인정보 보호법」 제28조의8 제1항 제3호에 따라 다음 사항을 공개합니다.

| 항목 | 내용 |
| --- | --- |
| 이전받는 자 | Google LLC 및 그 계열사(Gemini API 유료 서비스 제공 법인). 개인정보 문의: https://support.google.com/policies/contact/general_privacy_form |
| 이전 국가 | 미국 등 Google 또는 그 대리인이 시설을 운영하는 국가 |
| 이전 항목 | AI 챗봇 대화와 답변에 쓰인 이용자 데이터 요약(자산·가계부·매매·가족·목표 등), 가계부 자동 분류를 위한 가맹점명, 파일 열 인식을 위한 표 머리글과 숫자를 가린 예시 행, 카드 명세서 AI 추출을 선택한 경우 그 파일(PDF·이미지) |
| 이전 시기와 방법 | 해당 기능을 이용할 때마다 암호화된 통신(HTTPS)으로 전송 |
| 이용 목적과 보유 기간 | AI 응답 생성. 운영자는 Google에 대화 저장을 요청하지 않습니다. Google은 유료 서비스의 요청·응답을 제품 개선에 쓰지 않으며, 금지된 사용을 탐지하기 위해 제한된 기간 동안 기록할 수 있습니다(Gemini API 추가 약관) |
| 거부 방법과 효과 | 국외 이전을 원하지 않으면 AI 챗봇과 카드 명세서 AI 추출을 쓰지 않으면 됩니다. 카드 이용내역 파일 업로드와 CODEF 가져오기는 가맹점 자동 분류에 AI를 함께 쓰므로 이 기능도 쓸 수 없습니다. 이 경우 가계부는 직접 입력해 이용할 수 있습니다 |

**8. 이용자의 권리와 행사 방법**

1. 이용자는 언제든지 자신의 개인정보를 열람·정정·삭제하거나 처리정지를 요구할 수 있습니다.
2. 열람·정정·삭제는 서비스의 각 화면에서 직접 할 수 있고, 계정 전체는 "설정 > 계정 > 계정 삭제"로 지울 수 있습니다. CODEF 연결을 지우면 CODEF에 등록된 로그인 정보도 함께 지웁니다.
3. 처리정지 요구와 그 밖의 요청은 개인정보 보호책임자에게 이메일로 할 수 있으며, 운영자는 지체 없이 조치합니다.
4. 법정대리인이나 위임을 받은 사람을 통해서도 권리를 행사할 수 있습니다. 이 경우 위임장을 제출해야 합니다.
5. 증권사 앱키는 이 서비스에서 지워도 증권사에는 발급된 상태로 남습니다. 필요하면 증권사 포털에서 해지할 수 있습니다.

**9. 개인정보의 안전성 확보 조치**

1. 비밀번호는 복호화할 수 없는 해시(argon2id)로만 저장합니다.
2. 증권사 앱키·시크릿·계좌번호와 CODEF 연결 식별값은 암호화해 저장합니다.
3. 모든 통신은 HTTPS로 암호화하고, 로그인 쿠키에는 Secure·HttpOnly 속성을 붙입니다.
4. 이용자별로 데이터를 분리해 다른 이용자의 정보에 접근할 수 없게 하고, 로그인 시도 횟수를 제한합니다.
5. 데이터베이스는 외부에서 직접 접속할 수 없게 운영하고 매일 백업합니다.
6. 업로드한 파일의 원본은 저장하지 않습니다.

**10. 개인정보 자동 수집 장치(쿠키)**

서비스는 로그인 유지를 위한 세션 쿠키 하나만 씁니다. 광고·분석용 쿠키와 행태정보 수집 도구는 쓰지 않습니다. 브라우저에서 쿠키를 막으면 로그인할 수 없습니다.

**11. 만 14세 미만 아동**

만 14세 미만은 가입할 수 없습니다.

**12. 개인정보 보호책임자**

| 항목 | 내용 |
| --- | --- |
| 성명 | {보호책임자} |
| 이메일 | {연락 이메일} |

**13. 권익침해 구제 방법**

개인정보 침해에 대한 신고나 상담이 필요하면 아래 기관에 문의할 수 있습니다.

- 개인정보분쟁조정위원회: 1833-6972 (www.kopico.go.kr)
- 개인정보침해신고센터: 국번 없이 118 (privacy.kisa.or.kr)
- 대검찰청: 국번 없이 1301 (www.spo.go.kr)
- 경찰청: 국번 없이 182 (ecrm.police.go.kr)

**14. 개인정보 처리방침의 변경**

이 처리방침은 {시행일}부터 적용합니다. 내용이 바뀌면 시행 7일 전에 이 화면으로 알립니다.

---

## 8. 테스트

- 백엔드: 계정 삭제 204와 쿠키 삭제, 모든 모듈 테이블에 행을 만든 뒤 삭제하면 그 사용자 행이 0건(다른 사용자 행은 그대로, `posts.author_id`는 NULL), 비밀번호 틀림·없음 422, 마지막 관리자 409(다른 관리자가 있으면 성공), 미인증 401, CODEF 연결 두 개 중 두 번째 삭제 실패 시 409와 사용자 유지·첫 연결 삭제 반영(respx), 키 없음 409, 로그·응답에 비밀번호 없음, 출생연도 만 14세 경계(13세 422, 14세 200), 실제 외부 호출 없음(`assert_all_mocked`).
- `delete_all_accounts`: 연결 없음, 모두 성공, 중간 실패 후 재시도 시 남은 연결만 처리.
- 프론트: `/privacy` 7절 제목·표·시행일과 환경변수 값 표시, 값이 비었을 때 경고와 "(미설정)", 가입 체크박스 필수와 링크, auth 레이아웃 링크, `/settings/account` 안내 네 항목·확인 창·성공 시 `/login?deleted=1`과 안내·422 메시지·409 CODEF 링크, 내비게이션 "계정".

## 9. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 실제 서버에서 계정 삭제 흐름(CODEF 연결 없는 사용자, respx로 CODEF 실패를 흉내 낸 사용자)과 `/privacy`(환경변수 있음·없음)를 확인한다
- [ ] 360·768·1280px에서 `/privacy`·`/settings/account`·가입 화면이 가로로 넘치지 않는다

## 10. 검증 체크리스트

1. `/privacy` 본문이 7절과 글자 단위로 같고, 환경변수 값이 브라우저 번들(`.next/static`)에 없다.
2. 계정 삭제 뒤 그 사용자의 행이 모든 사용자 테이블에서 0건이고 다른 사용자 데이터는 그대로다.
3. CODEF 삭제 실패 시 계정이 남고 409와 연결 화면 링크가 보인다.
4. 마지막 관리자 409, 비밀번호 422, 세션 쿠키 삭제.
5. 출생연도 만 14세 검사와 가입 체크박스.
6. Caddy 시도 제한에 계정 삭제 요청이 들어갔고, 프론트 컨테이너에 `PRIVACY_*` 다섯 개만 넘어간다.
7. 소유 경로 밖 변경 없음, 비밀값·개인 연락처가 저장소에 없음.

## 구현 결과

### 구현한 것

- **백엔드**
  - `DELETE /api/auth/me`(`require_json`, 인증 필요): 비밀번호 확인 → 마지막 관리자 확인 → `connectors.delete_all_accounts` → `users` 행 삭제(다른 사용자 테이블은 FK CASCADE, `posts.author_id`는 SET NULL) → commit → `clear_session_cookie`로 204. 요청 스키마 `DeleteAccountRequest.password`는 `SecretStr`(repr 제외)이다.
  - `connectors.delete_all_accounts(db, user_id)`: 연결을 `(created_at, id)` 오름차순으로 하나씩 기존 `delete_account`(기본 삭제, 연결마다 commit)로 지운다. `CONNECTOR_FAILED`(502)·`CONFLICT`(409)는 고정 경고 로그를 남기고 `AppError(409, "CONFLICT", "CODEF 연결을 지우지 못했습니다. …")`로 멈춘다. 연결이 없으면 아무것도 하지 않는다.
  - `PUT /api/profile`: 기존 범위 검사(스키마 1920~올해−10, DB CHECK 1900~2100)는 그대로 두고, 서비스에서 `올해(KST) − birthYear < 14`면 `field_error("birthYear", "만 14세 이상만 이용할 수 있습니다.")`. 기존 테스트·시드의 출생연도는 이 검사에 걸리지 않아 고치지 않았다.
- **프론트**
  - `/privacy`(앱 셸 밖 서버 컴포넌트): `await connection()` 뒤 `process.env`에서 `PRIVACY_*` 다섯 값을 요청 때 읽는다(Next.js 16 `environment-variables.md`의 "Runtime Environment Variables", `connection.md`). 빌드 결과에서 `ƒ /privacy`(동적)다. 7절 문구는 `features/privacy/content.ts`에 데이터로 두고 표·번호 목록·글머리 목록으로 그린다. 값이 하나라도 비면 경고 상자와 "(미설정)", 이메일은 `mailto:`, Google 문의 URL과 13절 기관 주소 네 개는 `target="_blank"`·`rel="noopener noreferrer"` 링크다. 표는 `role="region"`·`tabIndex=0`의 `overflow-x-auto` 영역 안에서만 가로로 스크롤하고, 인쇄 때는 영역을 펼친다(`print:` 변형).
  - 링크: `(auth)/layout.tsx` 본문 아래 작은 "개인정보 처리방침" 링크, 가입 폼 제출 버튼 위 필수 체크박스 "만 14세 이상입니다."(미체크 "만 14세 이상만 가입할 수 있습니다.", 서버로 보내지 않음)와 새 창 처리방침 링크 안내, 내비게이션 설정 그룹 "프로필" 다음 "계정"(`UserCog`).
  - `/settings/account`: "계정 정보" 카드(이메일, "개인정보 처리방침 보기"), 위험 영역 "계정 삭제" 카드(안내 네 항목, `autoComplete="current-password"` 비밀번호, 빨간 버튼 → 확인 창 → `DELETE /api/auth/me`). 성공하면 `AuthProvider.deleteAccount`가 쿼리 캐시를 비우고 로그아웃 상태(`signedOut`)로 바꾼 뒤 `/login?deleted=1`로 보낸다. 로그인 폼은 `deleted=1`이면 "계정을 삭제했습니다."(`role="status"`)를 보여 주고 주소에서 `deleted`를 지워 새로 고치면 다시 나오지 않는다. 422는 비밀번호 칸 아래, CODEF 409는 메시지와 "데이터 자동 수집으로 이동"(`/settings/connections`), 그 밖의 409·오류는 메시지만 보여 주고 실패하면 비밀번호 칸을 비운다.
- **배포**: `.env.production.example`에 값 없는 `PRIVACY_*` 다섯 키, `compose.prod.yaml`의 `frontend`에 이 다섯 개만 런타임 `environment`로 전달, `Caddyfile`의 `auth` 시도 제한 zone에 `DELETE /api/auth/me` match 블록 추가(로그인·가입과 같은 10분 10회 카운터), `README.md`에 3.1절(운영자 정보 다섯 값 넣는 법·`dc up -d frontend`), 4절 `/privacy` 확인과 계정 삭제 제한, 10절 공개 전 확인(법률 검토 권장·시행일·호스팅 업체 이름·탈퇴 확인)을 적었다.

### 스펙에 없던 세부 사항과 구현 선택

- 비밀번호 키가 없거나 빈 값이면 스키마 기본값 `""`로 받아 서비스에서 같은 `field_error("password", "비밀번호가 맞지 않습니다.")`를 낸다. 128자(가입 최대 길이)를 넘으면 해시 검증 없이 같은 422다. 문자열이 아니면 기존 검증 처리기의 `password` 필드 422다.
- `connectors.repository.list_accounts`는 최신순이라(17 소유, 고치지 않음) `delete_all_accounts` 안에서 오름차순으로 정렬한다. 그 사이 다른 요청이 먼저 지운 연결(`NOT_FOUND`)은 건너뛴다.
- `auth.service`가 `connectors.service`를 모듈 위에서 import하면 `connectors → allocation → auth` 순환 import가 생겨(allocation을 먼저 import하는 경우 `ImportError`) `delete_account` 함수 안에서 불러온다.
- 계정 화면은 비밀번호가 비어 있으면 서버에 보내지 않고 "비밀번호를 입력해 주세요."를 보여 준다(확인 창도 열지 않는다). CODEF 409는 `status === 409`이고 메시지에 "CODEF"가 들어 있으면으로 판별한다.
- `PRIVACY_EFFECTIVE_DATE`가 `YYYY-MM-DD`가 아니거나 달력에 없는 날짜면 미설정으로 보고 경고한다. 값은 앞뒤 공백을 걷는다.
- 7절 문구는 스펙 마크다운에서 기계적으로 옮겨(저장소 밖 일회성 스크립트) `content.ts`를 만들었고, 테스트(`tests/privacy/privacy.test.tsx`)가 매번 스펙 7절을 다시 읽어 화면의 제목·문단·목록 항목·표 칸 98개와 글자 단위로 비교한다. 문구는 다듬지 않았다.
- 코디네이터 승인(2026-10-19)으로 `tests/foundation/auth-forms.test.tsx`(가입 제출 전 체크박스 클릭 세 줄)와 `tests/foundation/navigation.test.tsx`("계정" 한 줄)를 고쳤고, `lib/navigation.ts`의 `UserCog` import 한 줄도 승인받았다. 체크하지 않은 제출 오류 테스트는 `tests/auth`에 두었다.
- 의존성·마이그레이션 변경은 없다.

### 실행한 검증

| 명령·확인 | 결과 |
| --- | --- |
| `scripts/worktree-setup.sh` | 슬롯 19·8019/3019·finance_19 준비 성공 |
| `cd backend && uv run ruff check .` / `uv run ruff format --check .` | 통과 / 307개 파일 통과 |
| `cd backend && uv run pytest` | 1,421개 통과(새 테스트: `tests/auth` 18개, `test_delete_all_accounts.py` 7개). 기존 Starlette/httpx 사용 중단 경고 1개 |
| `cd frontend && npm run lint` / `npx tsc --noEmit` | 통과 / 통과 |
| `cd frontend && npm run test` | 50개 파일·502개 통과(새 테스트: `tests/privacy` 7개, `tests/auth` 13개) |
| `cd frontend && npm run build` | 통과. `ƒ /privacy`(요청 시 렌더링), `○ /settings/account` |
| 가짜 `PRIVACY_*` 값을 넣고 `npm run build` 뒤 `.next` 전체 검색 | 다섯 값 모두 `.next/static`·`.next` 어디에도 없음(서버 청크에 키 이름만 있음) |
| 가짜 env 파일로 `docker compose -f deploy/compose.prod.yaml config --format json` | `frontend.environment`가 `PRIVACY_*` 다섯 개뿐이고 다른 서비스에는 `PRIVACY_*` 없음 |
| `deploy/caddy` 이미지를 임시로 빌드해 `caddy adapt`·`caddy validate` | "Valid configuration". `auth` zone의 `match`가 `[POST login·signup, DELETE /api/auth/me]` 두 matcher set(플러그인 `caddyfile.go`가 append, `handler.go`가 `AnyMatch`). 확인 뒤 임시 이미지 삭제 |
| `git diff --name-only develop...HEAD` | 모두 3절 소유 경로(승인된 foundation 테스트 두 곳 포함) |

- 백엔드 테스트는 모든 사용자 테이블(users.id를 참조하는 25개, `posts`는 SET NULL)에 두 사용자 행을 만든 뒤 한 사용자를 지워 그 사용자 행 0건, 다른 사용자 행 수 유지, 탈퇴자 글의 `author_id` NULL, 다른 사용자 북마크 유지를 확인한다. 메타데이터에서 사용자 테이블 목록을 구해 새 테이블이 생기면 테스트가 실패한다. 그 밖에 쿠키 삭제(`Max-Age=0`)·세션 삭제·재가입, 비밀번호 틀림·빈 값·없음·초과 길이 422, 비 JSON 422, 미인증 401, 마지막 관리자 409와 다른 관리자가 있을 때 204, CODEF 두 연결 중 두 번째 실패 시 409·사용자 유지·첫 연결 삭제 반영·재시도 때 남은 연결만 호출, 키 없음 409, 로그·응답에 비밀번호·connectedId·외부 메시지 없음, 출생연도 13세 422·14세 200(KST 연말 경계 포함)을 확인한다. CODEF는 respx(`assert_all_mocked=True`)로만 흉내 내고 루트 conftest의 외부 HTTP 차단을 유지했다.
- 실제 서버(슬롯 19, `scripts/start.sh`)와 독립 헤드리스 Chrome 컨텍스트(저장소 밖 스크래치의 playwright-core)로 확인했다.
  - `/privacy`(가짜 값 있음·없음 두 번 기동): 본문 98블록이 7절과 글자 단위로 같음, 값 있음은 경고 없음·mailto·외부 링크 속성, 값 없음은 경고와 "(미설정)", 표 5개, 인쇄 미디어에서 표 영역 `overflow: visible`. 브라우저의 4xx는 모든 화면의 루트 `AuthProvider`가 부르는 기존 `GET /api/auth/me` 401뿐이고 외부 요청 0건.
  - CODEF 연결 없는 사용자: 가입 화면 미체크 오류·새 창 처리방침 링크·레이아웃 링크, 체크 후 가입, API로 출생연도 13세 422·14세 200, 계정 화면 안내 네 항목, 틀린 비밀번호 422(칸 비움), 확인 창을 거친 삭제 → `/login?deleted=1` 안내 → 주소 정리, 세션 쿠키 없음, `/api/auth/me`·재로그인 401, 새로 고치면 안내 없음.
  - respx로 CODEF 실패를 흉내 낸 사용자: 저장소 밖 임시 스크립트가 프로세스 메모리에만 가짜 CODEF 키를 넣고 respx(`assert_all_mocked=True`)로 토큰·계정 삭제 응답을 고정한 백엔드를 8019에 띄웠다. 가짜 connectedId 연결 두 개를 finance_19에 넣고 화면에서 삭제하면 첫 연결 성공·두 번째 `CF-03002` → 409 메시지와 "데이터 자동 수집으로 이동" 링크(이동 확인), 비밀번호 칸 비움, 계정 유지(`/me` 200), 연결은 두 번째만 남음. 다시 삭제하면 두 번째 연결만 CODEF에 요청하고 204 → 로그인 화면 안내. 서버 로그에는 고정 문구와 결과 코드만 있고 비밀번호·가짜 키·connectedId가 없었다. 실제 CODEF·LLM·증권사는 호출하지 않았다.
  - 360·768·1280px에서 `/privacy`·`/signup`·`/settings/account` 모두 `scrollWidth == innerWidth`. 360px에서 처리방침 표는 표 영역 안에서만 가로로 스크롤한다(스크린샷 확인).
  - 확인용 사용자는 확인 뒤 모두 삭제했고, 띄운 서버는 임시 백엔드를 종료한 뒤 `scripts/stop.sh`로 멈췄다.

### 남은 일

- 코디네이터 검증과 병합.
- 운영자가 서버 `.env.production`에 실제 `PRIVACY_*` 값을 넣고, 가입을 열기 전에 처리방침 법률 검토를 받는다(README 10절).
- 실제 CODEF 키로 연결이 있는 계정의 탈퇴는 확인하지 않았다(respx로만 확인).
