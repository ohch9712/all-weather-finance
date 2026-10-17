# 14. 증권사 잔고를 자산배분에 자동 반영

> 웨이브 3 · 브랜치 `feature/14-holdings-sync` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 02(자산배분), 08(증권사 게이트웨이)이 develop에 병합된 상태.
> **착수 직전 갱신**: 코디네이터는 02의 `holdings` 실제 코드와 08 `## 구현 결과`의 `HOLDINGS` 구현 여부를 확인한다. 실제 어댑터가 하나도 잔고를 지원하지 않으면 Mock 전용으로 진행하고 그 사실을 적는다.
> **갱신함(2026-10-17, develop `8a5d8f4` 기준)**: 08은 세 공급자 모두 `HOLDINGS`를 구현했다.
>
> | 공급자 | 잔고 | 예수금(`cash_krw`) | 비고 |
> | --- | --- | --- | --- |
> | 키움 | `kt00018`, 국내 잔고 | `None` | `market=OTHER` |
> | 토스 | `getHoldings` | `None` | 원화 환산값 없는 USD 보유는 `eval_amount=None` |
> | Mock | 5종목(각 10주) | `5000000` | |
>
> 02의 `holdings.source` CHECK가 `mock`을 허용하지 않아서, 개발용 Mock 연결(`provider="mock"`)로 동기화할 수 있게 4·6절에 `mock`을 더했다. 연결 별칭·공급자는 08의 `market.service.list_connections`로 읽는다(6.1).

## 1. 목표

- 사용자 증권사 연결(08)의 보유 종목·예수금을 가져와 자산배분의 보유 자산으로 자동 등록·갱신한다.
- ETF·펀드 이름으로 자산군(주식·채권·금·현금·기타)을 자동 분류하고, 사용자가 바꾼 분류는 다음 동기화에서도 유지한다.
- 17(CODEF 계좌 잔액)도 같은 함수로 현금 자산을 반영할 수 있게 서비스 함수를 제공한다.

## 2. 범위

### 포함

- `allocation_0002` 마이그레이션, 분류 규칙, 동기화 API, `upsert_synced_holdings`
- 02 코드 수정: 동기화 자산의 분류 수정 시 `class_override` 기록, 목록에 동기화 정보 표시
- 화면 `/allocation/assets`에 "증권사 잔고 불러오기"

### 제외

- 외화 자산의 환율 환산: 증권사가 원화 평가금액을 주지 않는 외화 보유분은 건너뛰고 알려 준다
- 자동 주기 동기화: 범위 밖

## 3. 소유 파일

- `backend/app/modules/allocation/**`(02 코드 수정 포함)
- `backend/alembic/versions/allocation_0002_*.py`
- `backend/tests/allocation/**`
- `frontend/src/app/(app)/allocation/assets/**`
- `frontend/src/features/allocation/**`
- `frontend/tests/allocation/**`
- 이 문서의 `## 구현 결과`

## 4. DB 변경 (revision `allocation_0002`, `--head allocation@head`)

- `holdings`에 컬럼 추가: `external_ref varchar(64) NULL`, `connection_id uuid NULL`(FK 없음), `synced_at timestamptz NULL`, `class_override boolean NOT NULL DEFAULT false`.
- 부분 유일 인덱스 `(user_id, connection_id, external_ref) WHERE external_ref IS NOT NULL`.
- `holdings.source` CHECK를 `source in ('manual','kiwoom','toss','codef','mock')`로 바꾼다(02의 `SOURCE_CHECK` 상수도 같이 고친다). downgrade는 `mock` 행을 지운 뒤 예전 CHECK로 되돌린다.

## 5. 자산군 자동 분류 (`allocation/classify.py`)

종목명(대소문자 무시)에 아래 키워드가 있으면 그 자산군. 위에서부터 첫 일치, 없으면 `stock`. 결과와 함께 일치한 키워드(근거)를 돌려준다.

| 자산군 | 키워드 |
| --- | --- |
| `cash` | MMF, 머니마켓, CD금리, KOFR, SOFR, 파킹, 단기자금, 초단기, BIL, SGOV |
| `bond` | 채권, 국채, 국고채, 회사채, 단기채, 장기채, 크레딧, 통안채, 국공채, 하이일드, TREASURY, BOND, TLT, IEF, SHY, BND, AGG |
| `gold` | 골드, 금현물, 금선물, KRX금, GOLD, GLD, IAU |
| `other` | 리츠, REIT, 원유, WTI, 원자재, 구리, 천연가스, 비트코인, 이더리움, 인프라 |

- 한 글자 키워드("금", "은")는 쓰지 않는다(다른 단어와 섞인다). 예수금은 항상 `cash`.

## 6. 동기화

### 6.1 `POST /api/allocation/holdings/sync`

- 요청 `{"connectionId": "…"}`
- `market.service.get_user_broker_client(db, user_id, connection_id).get_holdings()` → `upsert_synced_holdings(...)` → commit
- 연결의 공급자(`provider`: `kiwoom`·`toss`·`mock`)와 별칭(`label`)은 `market.service.list_connections(db, user_id)`(08, `list[Connection]`)에서 같은 `id`를 찾아 쓴다. 공급자 값이 그대로 `source`다.
- `BrokerHolding` → `SyncedHolding`: `external_ref=code`, `name=name`(50자를 넘으면 자른다), `amount=eval_amount`. `eval_amount`가 `None`이면 `skipped`.
- 응답 `200 HoldingSyncResult`

```json
{ "created": 3, "updated": 2, "removed": 1,
  "skipped": [ { "name": "Apple", "reason": "원화 평가금액이 없어 건너뛰었습니다." } ],
  "syncedAt": "2026-10-16T06:00:00Z" }
```

- 오류는 11과 같다(404, `409 BROKER_NOT_CONNECTED`, `501`, 08 에러 변환).

### 6.2 `upsert_synced_holdings` 규칙

```python
@dataclass(frozen=True)
class SyncedHolding:
    external_ref: str        # 종목코드, 예수금은 "__cash__", CODEF 계좌는 계좌 식별값(마스킹)
    name: str
    amount: int              # 원화 평가금액
    asset_class: AssetClass | None = None   # None이면 5절 분류

def upsert_synced_holdings(db, user_id, *, source: Literal["kiwoom", "toss", "codef", "mock"], connection_id: UUID,
                           items: list[SyncedHolding]) -> HoldingSyncResult
```

- flush와 점수 스냅샷 갱신까지 하고 commit하지 않는다. 14의 동기화 API와 17이 트랜잭션을 끝낸다(10의 `import_entries`와 같은 규칙).

- `(connection_id, external_ref)`가 같은 행이 있으면 이름·금액·`synced_at`을 갱신한다. `class_override=false`일 때만 자산군을 다시 분류한다.
- 없으면 새로 만든다(`source`, `include_in_allocation=true`).
- 이번 목록에 없는 같은 연결의 기존 행은 삭제한다(`removed`).
- 08 결과의 예수금(`cash_krw`)은 `external_ref="__cash__"`, 이름 "예수금(<연결 별칭>)", `cash`. `cash_krw`가 `None`이면(키움·토스) 예수금 행을 만들지 않는다.
- 금액은 0 이상 정수. 외화이고 원화 평가금액이 없으면 `skipped`.
- 끝나면 02의 점수 스냅샷 갱신(`service._refresh_snapshot`)을 호출한다.

### 6.3 02 코드 수정

- `PATCH /api/allocation/holdings/{id}`에서 동기화 행(`connection_id` 있음)의 `assetClass`를 바꾸면 `class_override=true`.
- 동기화 행의 `amount`·`name` 수정은 막는다(`409 CONFLICT`, "증권사에서 불러온 자산은 금액을 직접 바꿀 수 없어요. 다시 동기화해 주세요."). 삭제는 허용하되 다음 동기화에서 다시 생긴다고 안내한다.
- `Holding` 응답에 `connectionId`, `syncedAt`, `classOverride`를 더한다.

## 7. 화면 명세 (`/allocation/assets`)

- "증권사 잔고 불러오기" 버튼 → 다이얼로그: 활성 연결 선택(없으면 `/settings/connections` 안내) → 실행 → 결과 요약(추가·갱신·삭제·건너뜀 목록). 연결 목록은 08의 `GET /api/market/connections`를 `features/allocation/api.ts`에서 부른다(`status=active`만 선택 가능).
- 동기화 자산 행: 증권사 배지, 마지막 동기화 시각, 자동 분류 근거 툴팁, 분류를 바꿨으면 "직접 지정" 표시, 금액 수정 비활성.
- Mock 연결(`source=mock`)로 불러온 행에는 "샘플" 배지를 달고, 그런 행이 하나라도 있으면 목록에 `Disclaimer variant="sample"`을 붙인다.
- 배분에 포함된 자산 중 `source=mock` 행이 하나라도 있으면 `/allocation` 리포트와 추천 결과 화면(`features/allocation`의 리포트·추천 컴포넌트)에도 `Disclaimer variant="sample"`을 붙인다(갱신 2026-10-17, 웨이브 3 통합 검증 K2). 배분 계산은 바꾸지 않는다.
- 연결별 "다시 동기화" 버튼.

## 8. 테스트

### 백엔드

- 분류 규칙 표의 대표 이름(예: "KODEX 200"=stock, "TIGER 미국채10년선물"=bond, "ACE KRX금현물"=gold, "KODEX CD금리액티브"=cash, "TIGER 리츠부동산인프라"=other), 한 글자 키워드 미사용
- MockBroker 잔고로 첫 동기화 생성, 두 번째 갱신, 종목이 빠지면 삭제, 예수금 행, 외화 건너뜀
- `class_override` 유지, 동기화 행 금액 수정 409
- `upsert_synced_holdings`를 `source="codef"`로 직접 호출(17 시나리오)
- 02 테스트 회귀 없음, 사용자 격리 404

### 프론트

- 불러오기 다이얼로그 흐름, 동기화 행 표시, 분류 변경

## 9. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] Mock 잔고로 동기화하면 배분 리포트 점수가 바뀐다

## 10. 검증 체크리스트

1. 5절 키워드 표와 순서가 같다.
2. 동기화가 멱등이다(같은 입력 두 번 → 두 번째는 변화 없음).
3. `class_override`와 금액 수정 차단이 동작한다.
4. `upsert_synced_holdings` 시그니처가 6.2와 같다(17의 전제).
5. 02의 기존 API·테스트가 깨지지 않았다.
6. 사용자 격리 404.

## 구현 결과

- `allocation_0002`에 동기화 메타데이터 4개 컬럼, 사용자·연결·외부 식별값 부분 유일 인덱스와 `mock` 원천 CHECK를 추가했다. downgrade는 Mock 행을 지우고 기존 CHECK와 컬럼으로 복원한다.
- `classify.py`는 5절의 키워드와 순서 그대로 자산군·일치 키워드를 반환한다. `POST /api/allocation/holdings/sync`는 market의 공개 서비스 두 개만 이용해 잔고·예수금을 반영하고, 원화 평가금액 없는 종목은 건너뜀 목록에 표시한다.
- `service.SyncedHolding`·`upsert_synced_holdings`를 6.2의 시그니처로 제공한다. 동일 사용자·연결 안에서만 생성·갱신·삭제하며 분류 직접 지정, 배분 포함 여부와 메모를 보존한다. 점수 스냅샷과 flush까지만 실행하고 API가 commit한다. CODEF 호출과 호출자 롤백을 테스트했다.
- 동기화 자산은 이름·금액 PATCH를 409로 차단하고, 자산군을 변경하면 `classOverride=true`로 저장한다. 기존 보유 자산 응답에는 `connectionId`, `syncedAt`, `classOverride`만 추가했다.
- 보유 자산 화면에 활성 연결 선택·동기화 결과·연결별 재동기화, 공급자/샘플/직접 지정 배지, 마지막 동기화 시각과 분류 근거 툴팁을 추가했다. 이름·금액 입력은 비활성화하고 자산군·포함 여부·메모만 PATCH한다. Mock의 sample 및 자산배분의 investment 고지를 유지한다.
- 스펙과 다르게 한 점: 없음. 세부 결정으로 `updated`는 이번 목록에서 갱신한 기존 행 수로 센다. 동일 입력의 재동기화는 행·금액·분류를 그대로 유지하면서 마지막 동기화 시각을 갱신한다. 호출자 입력의 금액·식별값·이름 오류는 쓰기 전에 `field_error`로 검증한다. 프론트의 근거 툴팁은 API 계약 필드를 늘리지 않고 같은 키워드 표를 이용한다.
- 검증(2026-10-17):
  - `scripts/worktree-setup.sh`, `uv run alembic upgrade heads`: 성공.
  - `uv run ruff check .`, `uv run ruff format --check .`: 통과.
  - `uv run pytest`: **1,055개 통과**(기존 자산배분 429개 및 새 동기화 25개 포함). 외부 HTTP는 공통 테스트 픽스처가 차단한다.
  - 별도 빈 DB `finance_14_impl_verify`에서 `upgrade heads` → `downgrade base` → `upgrade heads`: 모두 성공, 검증 DB 삭제 완료.
  - `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`: 모두 통과, 프론트 테스트 **356개 통과**.
  - 독립 Orca 프로필에서 실제 로컬 HTTP로 가입·프로필·성향·Mock 연결을 준비하고 화면에서 동기화: 첫 실행 6개 생성, 두 번째 6개 갱신. 점수 변경·사용자 격리·외화 건너뜀·금액 수정 차단은 백엔드 테스트로 검증했다.
  - 360px에서 목록·다이얼로그의 `documentElement.scrollWidth === innerWidth === 360`, 1280px에서도 `scrollWidth === innerWidth === 1280`을 확인했다. 모바일 캡처를 시각 검토했고 Mock 행 6개와 sample/investment 고지를 확인했다. 임시 브라우저 프로필은 삭제했다.
  - 변경 경로는 전부 3절 소유 범위 안이며 `git diff --check` 통과. `scripts/stop.sh`로 서버 종료 완료.
- 남은 일: 코디네이터의 별도 검증과 PR 병합. 실제 증권사 자격증명을 이용한 호출은 하지 않았다. 외화 환산·주기 동기화는 원래 제외 범위다.

### 웨이브 3 통합 검증 수정

- 경미 K2: 배분 리포트와 추천 결과에 `AllocationSampleDisclaimer`를 추가했다. 기존 `useHoldings()`와 `GET /api/allocation/holdings`를 재사용해 `source="mock"`이고 `includeInAllocation=true`인 행이 하나라도 있을 때만 공용 `Disclaimer variant="sample"`을 표시한다. 금액이 0인 Mock 행도 포함 여부에 따라 판단하며 기존 investment 고지를 유지한다.
- 프론트 컴포넌트와 테스트만 수정했다. 배분 계산, 백엔드 응답, 페이지 파일과 의존성은 바꾸지 않았다. 스펙과 다르게 한 점은 없다.
- `frontend/tests/allocation/sample-disclaimer.test.tsx`에 두 화면 각각 혼합 자산, 0원 Mock, 제외된 Mock, 수동 입력, 키움·토스·CODEF, 빈 목록의 표시 여부를 확인하는 16개 회귀 테스트를 추가했다. API는 기존 MSW 가짜를 사용하며 외부 API·LLM을 호출하지 않는다.
- 검증(2026-10-17): `scripts/worktree-setup.sh` 성공. `npm run lint`, `npx tsc --noEmit`, `npm run test`(44개 파일·432개 테스트), `npm run build`, `git diff --check` 모두 통과했다.
- 독립 Playwright 브라우저 세션에서 실제 로컬 서버에 로그인하고 수동 자산만 있을 때 두 화면의 샘플 고지 미표시, 개발용 Mock 연결 잔고 6개 동기화 후 표시, 모든 Mock 행을 배분에서 제외한 뒤 미표시를 확인했다. 두 화면 모두 360px·1280px에서 `documentElement.scrollWidth === innerWidth`를 확인하고 모바일 캡처를 시각 검토했다. `scripts/stop.sh`로 서버를 종료했다.
- 남은 일: 코디네이터의 별도 검증과 PR 병합.
