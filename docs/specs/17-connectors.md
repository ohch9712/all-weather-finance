# 17. 데이터 자동 수집: CODEF 커넥터, 마이데이터 스텁

> 웨이브 4 · 브랜치 `feature/17-connectors` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 10(`ledger.import_entries`), 14(`allocation.upsert_synced_holdings`)가 develop에 병합된 상태.
> **착수 직전 갱신**: 코디네이터는 CODEF 개발가이드(https://developer.codef.io/common-guide)의 현재 내용(도메인, 토큰, 요청·응답 인코딩, 상품 경로, 기관코드)을 확인해 4절 표의 "확인 필요" 항목을 채운 뒤 디스패치한다. 사용자에게 CODEF 데모 키가 없으면 샌드박스 전용으로 진행한다.

## 1. 목표

- 마이데이터는 금융위원회 허가를 받은 본인신용정보관리업자만 API를 쓸 수 있어 이 프로젝트에서 직접 연동할 수 없다. 이 사실을 화면과 API로 분명히 알린다.
- 대신 CODEF(데모·샌드박스)로 카드 승인내역을 가져와 가계부에 자동 기록하고, 은행 계좌 잔액을 자산배분의 현금 자산으로 반영한다.
- 공통 `DataConnector` 인터페이스를 만들어 나중에 다른 수집 경로를 붙일 수 있게 한다.

## 2. 범위

### 포함

- `integrations/codef/`(토큰, RSA 암호화, 요청·응답 처리, 기관코드)
- `connectors` 모듈: 계정(connectedId) 등록·삭제, 동기화 실행·이력, 제공자 상태
- `MyDataConnector` 스텁
- `/settings/connections`에 "데이터 자동 수집" 섹션 추가

### 제외

- CODEF 정식(유료) 계약, 인증서 로그인, 간편인증: 범위 밖. 아이디·비밀번호 로그인만
- 자동 주기 수집: 범위 밖(사용자가 버튼으로 실행)

## 3. 소유 파일

- `backend/app/integrations/codef/**`
- `backend/app/modules/connectors/**`
- `backend/alembic/versions/connectors_0001_*.py`
- `backend/tests/connectors/**`
- `frontend/src/app/(app)/settings/connections/**`(08이 만든 페이지에 섹션 추가)
- `frontend/src/features/connectors/**`
- `frontend/tests/connectors/**`
- 이 문서의 `## 구현 결과`

## 4. CODEF 연동 (`integrations/codef/`)

코디네이터가 2026-10-17에 확인한 값이다. 출처는 CODEF 개발가이드(https://developer.codef.io/common-guide/rest-api, `/common-guide/connected-id/register`·`/delete`. 가이드 화면은 공개 조회 API `https://admin.codef.io/dev-guide-menu/menu-detail/<코드>?mode=real`과 상품 파라미터 `…/api-input-param/<코드>`·`…/api-output-param/<코드>`에서 본문을 읽는다), 가이드가 안내하는 공식 라이브러리 `codef-io/easycodefpy`(`easycodefpy/properties.py`·`connector.py`·`util.py`), 가이드의 "기관별 로그인 제공 현황" 시트(https://docs.google.com/spreadsheets/d/1VxZKdL_mNzQDh31DEdzwFDo94TvBfWVeemgRHY2P6Yk, 카드-개인 2021-10-27·은행-개인 2022-03-14 기준)다. 코드 주석에 해당 URL을 남긴다.

| 항목 | 값 | 출처 |
| --- | --- | --- |
| 키 발급 | CODEF 홈페이지 가입 → 샌드박스 키 즉시, 데모(일 100회)는 신청 후 승인. 키는 `clientId`·`clientSecret`·`publicKey` 세 가지 | 가이드 rest-api |
| 환경 도메인 | 샌드박스 `https://sandbox.codef.io`, 데모 `https://development.codef.io`, 정식 `https://api.codef.io`. `CODEF_ENV`(`sandbox`·`development`·`production`)로 고른다 | easycodefpy `properties.py` |
| 토큰 | `POST https://oauth.codef.io/oauth/token`, 헤더 `Authorization: Basic base64("{clientId}:{clientSecret}")`, `Content-Type: application/x-www-form-urlencoded`, 본문 `grant_type=client_credentials&scope=read`. 응답 JSON의 `access_token`. 유효기간 1주일이라 메모리에 두고 재사용하고, 만료 1시간 전이거나 상품 응답이 401이면 다시 받는다 | 가이드 rest-api, easycodefpy `connector.request_token`·`util.check_validity` |
| 상품 요청 | `POST <도메인><경로>`, 헤더 `Authorization: Bearer <access_token>`, `Accept: application/json`. 본문은 `json.dumps(body, ensure_ascii=False)`를 `urllib.parse.quote`로 URL 인코딩한 문자열 | easycodefpy `connector.execute`·`request_product` |
| 응답 | HTTP 200 본문을 `urllib.parse.unquote_plus`로 디코딩한 뒤 JSON. 형식 `{"result": {"code", "message", "extraMessage", "transactionId"}, "data": …}`. 성공은 `result.code == "CF-00000"`. 그 밖의 코드는 실패(`CF-03002`는 추가인증 요구라 이 작업에서는 실패로 처리). `data`는 상품에 따라 객체 또는 배열이고, 건이 하나면 배열 대신 객체로 올 수 있으므로 둘 다 받는다 | 가이드 rest-api·add-auth, easycodefpy |
| 비밀번호 암호화 | `publicKey`(Base64 DER 공개키)로 RSA PKCS#1 v1.5 암호화 후 Base64. `cryptography`의 `serialization.load_der_public_key`와 `padding.PKCS1v15()`를 쓴다(01a가 설치함) | 가이드 cid-register, easycodefpy `util.encrypt_rsa` |
| 계정 등록 | `POST /v1/account/create`, 본문 `{"accountList": [{"countryCode": "KR", "businessType": "CD"·"BK", "clientType": "P", "organization": "<기관코드>", "loginType": "1", "id": "<아이디>", "password": "<RSA 암호문>"}]}`. 응답 `data.connectedId`(실패 시 없음), `data.successList[]`, `data.errorList[]`(각 `code`·`message`·`organization`·`businessType`). `connectedId`가 없거나 `errorList`가 비어 있지 않으면 실패 | 가이드 cid-register |
| 계정 삭제 | `POST /v1/account/delete`, 본문 `{"connectedId": "…", "accountList": [{"countryCode": "KR", "businessType", "clientType": "P", "organization", "loginType": "1"}]}`. 기관을 모두 지우면 connectedId도 없어진다. 이 작업은 계정 하나에 connectedId 하나를 발급한다(계정 추가 `/v1/account/add`는 쓰지 않는다) | 가이드 cid-delete |
| 카드 승인내역 | 상품 `KR_CD_P_002`, `POST /v1/kr/card/p/account/approval-list`. 입력 `organization`, `connectedId`, `startDate`·`endDate`(`YYYYMMDD`), `orderBy: "0"`(최신순), `inquiryType: "1"`(전체 조회, 카드번호 불필요), `memberStoreInfoType: "0"`. 출력 항목: `resUsedDate`(사용일자 `YYYYMMDD`), `resUsedTime`, `resCardName`, `resMemberStoreName`, `resUsedAmount`(이용금액, 문자열), `resApprovalNo`, `resHomeForeignType`(`"1"` 국내·`"2"` 해외), `resCancelYN`(`"0"` 정상·`"1"` 취소·`"2"` 부분취소·`"3"` 거절), `resCancelAmount`(취소건만), `resKRWAmt`(원화금액), `resAccountCurrency`(ISO 4217), `resMemberStoreType`(가맹점 업종, 가맹점 포함 조회 때만) | 가이드 상품 KR_CD_P_002(입력·출력 파라미터) |
| 은행 보유계좌·잔액 | 상품 `KR_BK_1_P_001`, `POST /v1/kr/bank/p/account/account-list`. 입력 `organization`, `connectedId`. 출력 `data.resDepositTrust[]`(예금·신탁: `resAccount`, `resAccountDisplay`, `resAccountName`, `resAccountBalance`(문자열), `resAccountCurrency`, `resAccountDeposit`(`11` 수시입출·`12` 정기/적금·`13` 신탁·`10`·`14` 미분류), `resOverdraftAcctYN`), `resForeignCurrency[]`, `resFund[]`, `resLoan[]`, `resInsurance[]` | 가이드 상품 KR_BK_1_P_001 |
| 기관코드 | 아래 "지원 기관"만 `organizations.py`에 둔다 | 기관별 로그인 제공 현황 시트 |

지원 기관(개인, 아이디 로그인으로 등록·해당 상품이 ●인 곳 중 추가 입력이 필요 없는 곳)

- 카드(`businessType: "CD"`, 승인내역): `0301` KB국민카드, `0303` 삼성카드, `0304` NH농협카드, `0305` BC카드, `0306` 신한카드, `0307` 씨티카드, `0309` 우리카드, `0311` 롯데카드, `0315` 전북카드
  - 뺀 곳: `0302` 현대카드·`0313` 하나카드(아이디 로그인에 카드번호·카드 비밀번호 추가 입력 필요), `0316` 광주·`0320` 수협·`0321` 제주·`0002` 산업은행카드(아이디 로그인 미제공)
  - KB국민카드는 카드소지확인 화면으로 넘어가면 `CF-12108`을 돌려준다. 그대로 `CONNECTOR_FAILED`로 처리한다.
- 은행(`businessType: "BK"`, 보유계좌): `0003` IBK기업, `0004` KB국민, `0011` NH농협, `0020` 우리, `0023` SC제일, `0037` 전북, `0039` 경남, `0045` 새마을금고, `0071` 우체국, `0081` 하나, `0088` 신한
  - 뺀 곳: `0027` 씨티(아이디 로그인 때 SMS 추가인증), `0031` 대구(아이디 로그인에 출금계좌 정보 필요), `0089` K뱅크(개인뱅킹 웹 서비스 종료), 아이디 로그인 미제공 기관
  - 상품 안내 문구는 "공동인증서 로그인을 지원"이라고만 적고 시트는 아이디 로그인을 ●로 표시한다. 아이디 로그인 실제 동작은 데모 키로만 확인할 수 있으므로 화면에 "은행은 기관에 따라 아이디 로그인이 막힐 수 있어요" 안내를 붙인다.

### 4.1 응답 → 내부 타입 변환

- 카드 승인 1건 → `LedgerImportRow`
  - `occurred_on` = `resUsedDate`, `merchant` = `resMemberStoreName`(비어 있으면 그 행은 건너뛰고 `failed`에 센다), `card_name` = `resCardName`, `approval_no` = `resApprovalNo`(빈 값이면 None), `merchant_category` = `resMemberStoreType`(빈 값이면 None)
  - 금액: 국내(`resHomeForeignType == "1"`)는 `resUsedAmount`, 해외는 `resKRWAmt`. 쉼표를 지운 정수의 절댓값. 해외인데 `resKRWAmt`가 없으면 건너뛴다(외화는 가계부에 넣지 않는다).
  - `resCancelYN`이 `"1"`이면 `is_cancellation=True`(금액은 `resCancelAmount`가 있으면 그 값, 없으면 이용금액). `"2"`(부분취소)는 `resCancelAmount`가 있으면 그 금액으로 취소 행 하나를 만들고, 없으면 정상 승인으로 둔다. `"3"`(거절)은 건너뛴다. 이용금액이 음수(KB 취소전표매입)면 `is_cancellation=True`.
- 은행 예금 1건(`resDepositTrust`만) → `SyncedHolding`
  - `external_ref` = `"codef:" + sha256(f"{organization}|{resAccount}").hexdigest()[:24]`(계좌번호 원문을 저장하지 않는다)
  - `name` = `"{은행 이름} {resAccountName} ({계좌번호 끝 4자리})"`를 50자로 자른다
  - `amount` = `resAccountBalance` 정수, `asset_class="cash"`
  - `resAccountCurrency != "KRW"`, 마이너스 통장(`resOverdraftAcctYN == "1"`), 잔액이 음수인 계좌는 넣지 않는다. 외화·펀드·대출·보험 목록은 쓰지 않는다.
- 응답·로그·`summary`·예외 메시지에 계좌번호 원문, 카드번호, connectedId 원문을 남기지 않는다.

### 4.2 구현 메모

- `easycodefpy`는 설치하지 않는다(의존성 추가 금지). `httpx`와 `cryptography`로 위 형태를 직접 구현한다.
- easycodefpy 소스에 공개 샌드박스 clientId·secret 상수가 있지만 코드·테스트·문서에 옮기지 않는다. 키는 `CODEF_CLIENT_ID`·`CODEF_CLIENT_SECRET`·`CODEF_PUBLIC_KEY` 설정값만 쓴다. 테스트는 가짜 키와 테스트에서 만든 RSA 키 쌍을 쓴다.
- `ledger.import_entries`는 분류에 personal LLM(`ledger.categorize`)을 쓸 수 있다. 테스트는 `get_structured_llm`을 `FakeStructuredLLM`으로 바꾸거나 personal을 꺼 둔다.
- 카드 동기화의 `batch_id`는 동기화 행 id다. 10의 `/ledger/import/review?batch=<syncId>`는 이 id로 내역을 보여 준다(임포트 작업이 아니라 저장·중복·실패 줄은 나오지 않는다. 그 수는 17 화면의 동기화 결과에 보여 준다).
- 은행 계정을 삭제하면 `allocation.upsert_synced_holdings(..., connection_id=account_id, items=[])`로 그 계정에서 만든 현금 자산을 지운다(같은 트랜잭션에서 커밋).

- "확인 필요" 항목은 공식 가이드에서 확인한 값만 쓰고 코드 주석에 가이드 URL을 남긴다. 확인하지 못한 상품은 `CONNECTOR_NOT_SUPPORTED`로 둔다.
- 요청에 쓰는 사용자 로그인 비밀번호는 메모리에서 RSA로 암호화해 바로 보내고 **어디에도 저장하지 않는다**(DB, 로그, 예외 메시지, 테스트 스냅샷 모두). 아이디도 저장하지 않는다. 저장하는 것은 connectedId(Fernet 암호화)뿐이다.
- 토큰은 만료까지 메모리 캐시. 호출 실패는 `CONNECTOR_FAILED`(502)로 바꾸고 CODEF 결과 코드는 `error_code`로 기록한다.

## 5. `DataConnector` 인터페이스 (`connectors/base.py`)

```python
class DataConnector(Protocol):
    key: Literal["codef", "mydata"]
    def is_available(self) -> bool                                  # 키 설정 여부
    def register_account(self, *, kind: Literal["card", "bank"], organization: str,
                         login_id: str, password: str) -> str      # connectedId
    def delete_account(self, connected_id: str, *, kind: str, organization: str) -> None
    def fetch_card_approvals(self, connected_id: str, organization: str, start: date, end: date) -> list[LedgerImportRow]
    def fetch_bank_balances(self, connected_id: str, organization: str) -> list[SyncedHolding]
```

- `MyDataConnector`: `is_available()`는 항상 False, 나머지는 `CONNECTOR_NOT_SUPPORTED`("마이데이터는 금융위원회 허가를 받은 본인신용정보관리업자만 쓸 수 있어 개인 프로젝트에서는 연동할 수 없습니다.").
- `LedgerImportRow`는 10, `SyncedHolding`은 14의 타입이다. 은행 잔액은 계좌마다 `SyncedHolding`이고 값은 4.1을 따른다.

## 6. DB 스키마 (revision `connectors_0001`, `branch_labels=("connectors",)`)

### 6.1 `connector_accounts`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `provider` | `varchar(8)` | NOT NULL, CHECK `codef` |
| `kind` | `varchar(4)` | NOT NULL, CHECK `card, bank` |
| `organization` | `varchar(8)` | NOT NULL. 기관코드 |
| `label` | `varchar(30)` | NOT NULL |
| `connected_id_enc` | `text` | NOT NULL(Fernet) |
| `created_at` | `timestamptz` | NOT NULL |

UNIQUE `(user_id, provider, kind, organization)`.

### 6.2 `connector_syncs`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `account_id` | `uuid` | NOT NULL, FK `connector_accounts.id` ON DELETE CASCADE |
| `kind` | `varchar(16)` | NOT NULL, CHECK `card_approvals, bank_balances` |
| `status` | `varchar(10)` | NOT NULL, CHECK `running, succeeded, failed` |
| `range_start`, `range_end` | `date` | NULL |
| `started_at`, `finished_at` | `timestamptz` | |
| `summary` | `jsonb` | NULL. `ImportResult` 또는 `HoldingSyncResult` |
| `error_code` | `varchar(40)` | NULL |

## 7. API 계약 (모두 인증 필요)

| 메서드·경로 | 성공 |
| --- | --- |
| `GET /api/connectors/providers` | `200 {"items": [{"key": "codef", "available": true, "environment": "sandbox", "note": "…"}, {"key": "mydata", "available": false, "note": "마이데이터는 …"}]}` |
| `GET /api/connectors/organizations?kind=card` | `200 {"items": [{"code": "…", "name": "신한카드"}]}`(가이드 표) |
| `GET /api/connectors/accounts` | `200 {"items": [Account...]}` |
| `POST /api/connectors/accounts` | `201 Account` |
| `DELETE /api/connectors/accounts/{id}` | `204`(CODEF 계정 삭제 호출 후 행 삭제. CODEF 호출이 실패해도 행은 지우고 경고를 로그에 남긴다) |
| `POST /api/connectors/sync` | `200 Sync` |
| `GET /api/connectors/syncs?accountId=&page=` | `200 Page<Sync>` |

- `POST /accounts` 요청: `{"provider": "codef", "kind": "card", "organization": "…", "label": "신한카드", "loginId": "…", "password": "…", "consent": true}`. `consent`가 없으면 `422`("카드사 로그인 정보가 CODEF로 전송되는 데 동의해 주세요."). 제공자가 쓸 수 없으면 `409 CONFLICT`("CODEF 키가 설정되지 않았습니다."). `organization`이 4절 지원 기관(그 `kind`의 목록)에 없으면 `422 VALIDATION_ERROR`("지원하지 않는 기관입니다."). 같은 기관을 다시 등록하면 `409 CONFLICT`.
- `Account`: `{"id", "provider", "kind", "organization", "organizationName", "label", "createdAt"}`(connectedId 원문 없음)
- `POST /sync` 요청: `{"accountId": "…", "from": "2026-09-01", "to": "2026-10-16"}`(카드만 기간 사용, 최대 92일)
  - 카드: `fetch_card_approvals` → `ledger.import_entries(db, user_id, rows, source="codef", batch_id=sync_id)`
  - 은행: `fetch_bank_balances` → `allocation.upsert_synced_holdings(db, user_id, source="codef", connection_id=account_id, items=…)`
  - 동기화 행을 `running`으로 만들고 끝나면 `succeeded`/`failed`. 응답 `Sync`: `{"id", "accountId", "kind", "status", "rangeStart", "rangeEnd", "startedAt", "finishedAt", "summary", "errorCode"}`
- 남의 계정 404. 실패는 `502 CONNECTOR_FAILED`(동기화 행은 `failed`로 남는다), 미지원 `501 CONNECTOR_NOT_SUPPORTED`.

## 8. 화면 명세 (`/settings/connections`의 "데이터 자동 수집" 섹션)

- 마이데이터 안내 카드(왜 연동할 수 없는지), CODEF 상태(사용 가능 여부, 환경 배지 "샌드박스"·"데모").
- 계정 추가 다이얼로그: 종류(카드·은행), 기관 선택, 별칭, 아이디, 비밀번호, 경고 문구("입력한 로그인 정보는 저장하지 않고 CODEF로 한 번만 전송합니다. CODEF는 이 정보로 금융사에 로그인해 데이터를 가져옵니다."), 동의 체크.
- 계정 목록: 기관·별칭·종류, "가져오기"(카드는 기간 선택), 최근 동기화 결과(저장·중복·실패 또는 추가·갱신), 삭제.
- 계정을 삭제하면 그 계정의 동기화 이력 쿼리는 다시 요청하지 않고 캐시에서 지운다. 계정 목록에서 먼저 빼서 카드가 사라진 뒤 나머지(계정 목록·가계부·자산배분·홈)를 갱신한다. 삭제 뒤 `GET /api/connectors/syncs?accountId=<삭제한 계정>` 요청이 나가지 않아야 한다(웨이브 4 통합 검증 F1).
- 카드 가져오기 완료 후 "가계부에서 보기"(`/ledger/import/review?batch=<syncId>`) 링크.

## 9. 테스트

- `respx`로 CODEF 토큰·계정 등록·카드 승인·은행 잔액 응답을 고정(가이드 형식)해 전체 흐름
- RSA 암호화: 테스트용 키 쌍으로 암호화 → 복호화 일치
- 비밀번호·아이디가 DB·로그·예외 메시지·응답에 남지 않음(로그 캡처 검사)
- 카드 동기화가 `ledger.import_entries`로, 은행 동기화가 `allocation.upsert_synced_holdings`로 들어감(두 번 실행 시 중복 없음)
- 마이데이터 스텁 501, 키 없음 409, 동의 없음 422, 실패 시 동기화 행 `failed`, 사용자 격리 404
- 실제 외부 호출 없음(`assert_all_mocked`)

## 10. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] CODEF 샌드박스 키가 있으면 샌드박스로 카드 승인내역 → 가계부 반영을 수동 확인하고 `## 구현 결과`에 적는다. 키가 없으면 respx 테스트로만 검증했다고 적는다
- [ ] `## 구현 결과`에 4절 "확인 필요" 항목마다 확인한 값과 가이드 URL을 남긴다

## 11. 검증 체크리스트

1. 로그인 아이디·비밀번호가 어디에도 저장·기록되지 않는다(코드 검색 + 로그 캡처 테스트).
2. connectedId가 암호화 저장되고 응답에 원문이 없다.
3. 가이드로 확인하지 않은 상품 경로를 추측해 쓰지 않았다.
4. 10·14 서비스 함수만 호출하고 그 모듈 코드를 고치지 않았다.
5. 7절 응답·에러 코드가 같다.
6. 마이데이터 안내 문구가 화면과 API에 있다.

## 구현 결과

### 구현한 것

- `integrations/codef`에 환경별 도메인, Basic 토큰 발급·메모리 캐시(만료 1시간 전/상품 401 갱신), URL 인코딩 요청·응답, RSA PKCS#1 v1.5 암호화와 지원 기관 목록을 구현했다. 상품·계정 API는 4절에서 확인한 경로·필드만 사용한다.
- `DataConnector`, `CodefConnector`, `MyDataConnector`와 인증이 필요한 제공자·기관·계정·동기화·이력 API를 구현했다. 마이데이터는 항상 501, 키 부재·중복은 409, 동의·기관·카드 조회 기간 오류는 `field_error`의 422, 다른 사용자의 계정·이력 필터·삭제·동기화는 404다.
- revision `connectors_0001`에 계정·동기화 이력, 사용자·계정 FK 및 CASCADE, 기관 중복 제약과 인덱스를 추가했다. 로그인 아이디·비밀번호는 저장하지 않고 connectedId만 `app.core.crypto`로 암호화한다. 외부 응답 메시지는 오류·로그·이력에 넣지 않고 형식이 검증된 CODEF 결과 코드만 남긴다.
- 카드 승인내역은 `ledger.import_entries(..., source="codef", batch_id=sync_id)`, 원화 은행 예금은 `allocation.upsert_synced_holdings(..., source="codef", connection_id=account_id)`로 반영한다. 두 서비스는 flush까지만 호출하며 connectors가 commit한다. 실행 기록을 먼저 저장한 후 저장점 안에서 반영하여 실패하면 데이터 변경은 롤백하고 `failed` 이력은 보존한다. 은행 연결 삭제 때 해당 현금 자산도 같은 트랜잭션에서 제거한다.
- `/settings/connections`에 기존 `BrokerConnectionsSection`을 유지하고 데이터 자동 수집 섹션, 마이데이터 안내, CODEF 환경·가용 상태, 일회 전송 동의 폼, 계정 목록·기간 선택·가져오기·최근 결과·삭제·가계부 검토 링크를 추가했다. 개인 AI 공급자 배지와 투자·샘플·AI 고지를 사용한다. 등록 성공·실패 뒤에는 폼의 로그인 값을 비우며 영속 브라우저 저장소를 사용하지 않는다.

### 4절 확인 값과 출처

코디네이터가 2026-10-17에 확인해 제공한 4절 값을 그대로 사용했다. 추가로 추측한 경로·필드나 easycodefpy 설치·공개 샌드박스 키 복사는 없다.

| 항목 | 구현에 사용한 확인 값 | 출처 |
| --- | --- | --- |
| 키·환경 | 설정의 clientId/clientSecret/publicKey만 사용. sandbox/development/production 도메인은 각각 sandbox/development/api.codef.io | [CODEF REST 가이드](https://developer.codef.io/common-guide/rest-api), [공식 properties.py](https://github.com/codef-io/easycodefpy/blob/master/easycodefpy/properties.py) |
| 토큰·인코딩 | oauth.codef.io/oauth/token, Basic·폼 grant_type/client_credentials·scope/read, JSON→quote 요청, unquote_plus→JSON 응답, CF-00000 성공 | [CODEF REST 가이드](https://developer.codef.io/common-guide/rest-api), [공식 connector.py](https://github.com/codef-io/easycodefpy/blob/master/easycodefpy/connector.py), [공식 util.py](https://github.com/codef-io/easycodefpy/blob/master/easycodefpy/util.py) |
| RSA·등록·삭제 | DER 공개키·PKCS#1 v1.5·Base64, /v1/account/create·/v1/account/delete, KR·CD/BK·P·loginType 1, connectedId와 errorList 검사 | [계정 등록](https://developer.codef.io/common-guide/connected-id/register), [계정 삭제](https://developer.codef.io/common-guide/connected-id/delete) |
| 카드 | KR_CD_P_002·/v1/kr/card/p/account/approval-list, orderBy 0·inquiryType 1·memberStoreInfoType 0, 4.1의 사용일·원화금액·취소 변환 | [상품 출력 파라미터](https://admin.codef.io/dev-guide-menu/api-output-param/KR_CD_P_002), [상품 입력 파라미터](https://admin.codef.io/dev-guide-menu/api-input-param/KR_CD_P_002) |
| 은행 | KR_BK_1_P_001·/v1/kr/bank/p/account/account-list, resDepositTrust의 KRW·비마이너스·0 이상 잔액만, 계좌번호 해시와 끝 4자리 | [상품 출력 파라미터](https://admin.codef.io/dev-guide-menu/api-output-param/KR_BK_1_P_001), [상품 입력 파라미터](https://admin.codef.io/dev-guide-menu/api-input-param/KR_BK_1_P_001) |
| 지원 기관 | 4절의 카드 9곳·은행 11곳만 노출. 제외 기관은 등록 422. 은행 아이디 로그인 제약은 화면에 안내 | [기관별 로그인 제공 현황](https://docs.google.com/spreadsheets/d/1VxZKdL_mNzQDh31DEdzwFDo94TvBfWVeemgRHY2P6Yk) |

### 스펙의 미정 세부 사항에 대한 구현 선택

- 카드 조회 최대 92일은 시작일·종료일을 모두 포함한다(날짜 차이 0~91일). 은행 동기화의 기간은 사용하지 않고 이력에도 null로 저장한다.
- 공개 `list[LedgerImportRow]` 계약을 지키는 목록 하위 타입으로 변환 실패 수를 전달해 빈 가맹점·외화 원화금액 없음·날짜/금액 파싱 실패를 `summary.failed`에 합산한다. 거절 건은 실패로 세지 않고 제외한다. 카드 summary는 `ImportResult` 키를 유지하되 개인정보 비노출을 위해 `errors`는 빈 배열로 보관한다.
- 은행 응답의 형식이 잘못된 경우 일부 계좌만 반영하여 기존 자산을 지우지 않도록 전체 동기화를 실패 처리한다. 외화·마이너스 통장·음수 잔액은 스펙대로 제외한다.
- 공유 파일, 다른 모듈 파일과 의존성은 변경하지 않았다. 스펙의 API·DB·서비스 계약과 다른 점은 없다.

### 실행한 검증

| 명령·확인 | 결과 |
| --- | --- |
| `scripts/worktree-setup.sh` | 슬롯 17·8017/3017·finance_17 준비, 기존 의존성과 마이그레이션 적용 성공 |
| `cd backend && uv run ruff check .` | 통과 |
| `cd backend && uv run ruff format --check .` | 275개 파일 통과 |
| `cd backend && uv run pytest` | 1,214개 통과(커넥터 19개 포함). 기존 Starlette/httpx 사용 중단 경고 1개 |
| 빈 `finance_17_verify`에서 `uv run alembic upgrade heads` → `downgrade base` → `upgrade heads` | 모두 통과, 검증 DB 삭제 |
| `cd frontend && npm run lint` | 통과 |
| `cd frontend && npx tsc --noEmit` | 통과 |
| `cd frontend && npm run test` | 45개 파일·442개 테스트 통과(커넥터 6개 포함) |
| `cd frontend && npm run build` | Next.js 16.4.2 빌드 통과, `/settings/connections` 생성 |
| `scripts/start.sh` 후 독립 Orca isolated 프로필에서 로그인·화면 확인 | 360×800에서 innerWidth/scrollWidth 모두 360, 1280×800에서 모두 1280. 기존 증권사 섹션·새 수집 섹션·키 없음·마이데이터·고지 확인 |
| `git diff --check develop...HEAD`, 변경 경로 대조 | 공백 오류 없음, 소유 경로 안에서만 변경 |

- respx의 `assert_all_mocked=True`와 기존 외부 HTTP 차단 픽스처를 유지했다. URL 인코딩 요청·응답·result.code, RSA 복호화, 토큰 재사용·401/만료 갱신, 등록 부분 실패, 개인정보 비노출, 카드·은행 두 번 반영, 삭제 실패 후 로컬 삭제, 사용자 격리, 동기화 오류 이력·부분 반영 롤백을 검증했다.
- 이 워크트리에는 CODEF 키가 없어 샌드박스 수동 호출은 하지 않았고, **respx 테스트로만 CODEF 연동을 검증했다**. 실제 CODEF·LLM·증권사를 호출하는 테스트는 없다.
- 브라우저 검증 프로필·탭은 정리하고 띄운 서버는 `scripts/stop.sh`로 종료했다.

### 남은 일

- 코디네이터의 별도 검증과 PR 병합. 키가 제공된 환경에서의 CODEF 실제 샌드박스·데모 및 기관별 아이디 로그인 확인은 이 작업에서 실행하지 않았다.
