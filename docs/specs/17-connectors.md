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

| 항목 | 값 | 상태 |
| --- | --- | --- |
| 키 발급 | CODEF 홈페이지 가입 → 샌드박스 키 즉시, 데모(일 100회)는 신청 후 승인 | 확인됨 |
| 토큰 | `clientId`·`clientSecret`으로 accessToken 발급, HTTP 헤더에 담아 요청 | 확인됨(도메인·경로는 가이드로 확인) |
| 환경 도메인 | 샌드박스·데모·정식 도메인 | 확인 필요 |
| 요청·응답 인코딩 | 요청·응답 본문 인코딩 규칙(URL 인코딩 여부) | 확인 필요 |
| 비밀번호 암호화 | CODEF 공개키로 RSA 암호화해 전송 | 확인 필요(패딩 방식) |
| 계정 등록 | connectedId 발급(기관코드, 업무 구분 카드·은행, 로그인 방식 ID/PW) | 확인 필요(경로·필드) |
| 카드 승인내역 | 개인 카드 승인내역 상품 | 확인 필요(경로·필드) |
| 은행 계좌 목록·잔액 | 개인 은행 보유계좌 상품 | 확인 필요(경로·필드) |
| 기관코드 | 카드사·은행 코드표 | 가이드의 표를 `organizations.py`에 옮긴다 |

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
- `LedgerImportRow`는 10, `SyncedHolding`은 14의 타입이다. 은행 잔액은 계좌마다 `SyncedHolding(external_ref=<마스킹 계좌번호>, name="<은행> 예금", amount=잔액, asset_class="cash")`.

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

- `POST /accounts` 요청: `{"provider": "codef", "kind": "card", "organization": "…", "label": "신한카드", "loginId": "…", "password": "…", "consent": true}`. `consent`가 없으면 `422`("카드사 로그인 정보가 CODEF로 전송되는 데 동의해 주세요."). 제공자가 쓸 수 없으면 `409 CONFLICT`("CODEF 키가 설정되지 않았습니다.").
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
