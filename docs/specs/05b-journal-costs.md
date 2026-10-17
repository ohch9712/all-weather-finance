# 05b. 매매 수수료·세금 기본 요율 설정과 추정

> 선행: 05(매매일지)와 08b(국내 ETF 종류 구분)가 develop에 병합된 상태. 브랜치 `feature/05-journal-costs`(develop에서 새로 만든다. 05 워크트리와 슬롯 05를 다시 쓴다). 11은 이 작업이 병합된 뒤 시작한다.
> 결정(2026-10-17, 사용자): 체결 수수료·세금의 기본값은 **키움증권 기준**으로 둔다. 증권사 이벤트 등으로 일시적으로 바뀔 수 있으니 사용자가 설정에서 기본값을 바꿀 수 있게 한다.
> **착수 직전 갱신**: 코디네이터가 `frontend/src/lib/navigation.ts`(01b 소유)의 설정 그룹에 `{ href: "/settings/trading-costs", label: "매매 수수료·세금" }` 항목과 자리표시 페이지를 develop에 먼저 넣는다.
> **갱신함(2026-10-17, develop 기준)**: 내비게이션 항목(`BadgePercent` 아이콘)과 자리표시 페이지 `frontend/src/app/(app)/settings/trading-costs/page.tsx`(`ComingSoon taskId="05b"`), 01b 테스트 기대값을 develop에 넣었다. 08b가 병합돼 `market.service.get_stock_detail(db, code)`가 `kind`를 준다. 12(종목 상세)의 "내 매매 기록 보기" 링크를 위해 8절 끝에 매매일지 `symbol` 쿼리 처리를 더했다.

## 1. 목표

- 사용자마다 매매 수수료·세금 기본 요율을 저장하고, 설정 화면에서 바꾸거나 기본값으로 되돌릴 수 있게 한다.
- 거래의 수수료·세금을 모를 때(증권사가 주지 않는 체결, 수수료 열이 없는 파일, 수동 입력의 초기값) 이 요율로 **추정**한다. 추정한 거래는 표시해서 사용자가 실제 금액으로 고칠 수 있게 한다.

## 2. 기본 요율(키움증권 기준, 2026-10-17 사용자 제공)

| 항목 | 기본값 | 적용 |
| --- | --- | --- |
| 국내주식 매매수수료 | 0.015% | 국내(`market=KRX`) 매수·매도 거래금액 |
| 국내주식 매도 거래세 | 0.20% | 국내 **주식** 매도 거래금액. **국내 ETF 매도에는 붙이지 않는다**(증권거래세 비과세) |
| 미국주식 매매수수료 | 0.25% | 미국(`market=US`) 매수·매도 거래금액(USD) |

- 기본값은 `journal/costs.py`의 상수 한 곳에만 둔다. 미국 거래의 SEC 수수료 등 그 밖의 비용은 이번 범위 밖이다.
- 계산은 추정치다. 거래금액 = 수량 × 단가. 국내는 원 미만 버림, 미국은 0.01달러 미만 버림. 실제 증권사 계산(절사 단위 등)과 몇 원 다를 수 있다.

## 3. 범위

| 포함 | 내용 |
| --- | --- |
| DB | `trade_cost_settings` 테이블, `trades.cost_estimated` 컬럼(revision `journal_0002`) |
| API | 요율 조회·저장·되돌리기, 수수료·세금 추정 |
| 서비스 | `estimate_trade_costs`(11이 쓴다) |
| 화면 | `/settings/trading-costs` 설정 페이지, 매매 추가 다이얼로그의 추정 초기값, 거래 목록·상세의 "추정" 배지 |

| 제외 | 이유 |
| --- | --- |
| 이미 저장된 거래의 일괄 재계산 | 요율을 바꿔도 지난 거래는 그대로 둔다(저장 당시 값) |
| 증권사별·계좌별 요율 | 이번 결정은 사용자당 한 벌이다 |
| 미국주식 거래세·SEC 수수료, 환전 수수료 | 범위 밖 |

## 4. 소유 파일

- `backend/app/modules/journal/**`(새 파일 `costs.py` 포함)
- `backend/alembic/versions/journal_0002_*.py`
- `backend/tests/journal/**`
- `frontend/src/app/(app)/settings/trading-costs/**`(자리표시 교체)
- `frontend/src/app/(app)/journal/**`, `frontend/src/features/journal/**`, `frontend/tests/journal/**`
- 이 문서의 `## 구현 결과`

## 5. DB (revision `journal_0002`, `down_revision="journal_0001"`, 같은 `journal` 브랜치)

`trade_cost_settings`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `user_id` | `uuid` | PK, FK users ON DELETE CASCADE |
| `krx_commission_rate` | `numeric(6,4)` | NOT NULL, CHECK 0 이상 5 이하(%) |
| `krx_sell_tax_rate` | `numeric(6,4)` | NOT NULL, CHECK 0 이상 5 이하(%) |
| `us_commission_rate` | `numeric(6,4)` | NOT NULL, CHECK 0 이상 5 이하(%) |
| `updated_at` | `timestamptz` | NOT NULL |

- 행이 없으면 2절 기본값을 쓴다. "기본값으로 되돌리기"는 행을 지운다.
- `trades.cost_estimated boolean NOT NULL DEFAULT false`. 수수료·세금을 요율로 추정해 넣은 거래만 true다. PATCH로 `fee`나 `tax`를 바꾸면 false가 된다.

## 6. API 계약 (모두 인증 필요)

| 메서드·경로 | 요청 | 성공 |
| --- | --- | --- |
| `GET /api/journal/cost-settings` | | `200 CostSettings` |
| `PUT /api/journal/cost-settings` | `{"krxCommissionRate": "0.015", "krxSellTaxRate": "0.20", "usCommissionRate": "0.25"}` | `200 CostSettings` |
| `DELETE /api/journal/cost-settings` | | `200 CostSettings`(기본값) |
| `GET /api/journal/cost-estimate?market=KRX&side=sell&quantity=10&price=70000&symbolCode=005930` | | `200 {"fee": "105", "tax": "1400", "isEtf": false, "rates": CostSettings}` |

```json
// CostSettings (요율은 % 단위 문자열 decimal)
{ "krxCommissionRate": "0.015", "krxSellTaxRate": "0.20", "usCommissionRate": "0.25", "isDefault": true, "updatedAt": null }
```

- 검증: 요율은 0 이상 5 이하, 소수 넷째 자리까지(어기면 `field_error`로 `422`). 추정의 `quantity`·`price`는 0보다 크다. `market`은 `KRX`·`US`, `side`는 `buy`·`sell`.
- `isEtf`: `symbolCode`가 있고 `market=KRX`면 `market.service.search_stocks(db, symbolCode, limit=1)`의 첫 항목이 코드가 정확히 같고 `kind == "etf"`인지로 정한다(08b. 검색은 코드가 정확히 같은 종목을 맨 앞에 둔다). `get_stock_detail`은 시세 조회까지 해서 추정마다 증권사를 부르게 되므로 쓰지 않는다. 종목 마스터에 없으면 주식으로 본다.
- 거래 응답(`Trade`)에 `"costEstimated": true | false`를 더한다(05 응답 필드는 그대로 둔다).

## 7. 다른 모듈용 서비스 함수

```python
# app/modules/journal/service.py
@dataclass(frozen=True)
class TradeCosts:
    fee: Decimal
    tax: Decimal

def estimate_trade_costs(db, user_id: UUID, *, market: Literal["KRX", "US"], side: Literal["buy", "sell"],
                         quantity: Decimal, price: Decimal, is_etf: bool = False) -> TradeCosts
```

- 11이 증권사 체결의 `fee`·`tax`가 `None`(08b: 증권사 미제공)이거나 파일에 수수료·세금 열이 없을 때 부르고, 그 거래를 `cost_estimated=true`로 저장한다.

## 8. 화면

- `/settings/trading-costs` "매매 수수료·세금": 세 요율 입력(%, 소수 넷째 자리까지), 각 칸 아래 기본값("키움증권 기준 기본값 0.015%" 등), 저장, "기본값으로 되돌리기"(확인 창). 안내 문구: "증권사 이벤트 등으로 실제 요율과 다를 수 있어요. 증권사가 알려 준 실제 수수료·세금이 있으면 그 값이 우선이에요." "국내 ETF는 팔 때 거래세가 붙지 않아요."
- 매매 추가 다이얼로그(05): 시장·매수/매도·수량·단가가 채워지면 `cost-estimate`로 수수료·세금 초기값을 채운다(300ms 디바운스). 사용자가 수수료나 세금 칸을 직접 고친 뒤에는 덮어쓰지 않는다. 칸 아래에 "기본 요율로 계산한 추정치예요. 실제 금액으로 고칠 수 있어요."와 설정 페이지 링크. 기존 거래 수정에서는 자동으로 바꾸지 않는다(05의 변경 필드만 PATCH 규칙 유지).
- 거래 목록의 "수수료+세금" 칸과 상세에 `costEstimated`면 "추정" 배지.
- 매매일지 기록 탭은 URL 쿼리 `symbol`을 종목 검색 필터의 초기값으로 읽는다(`/journal?tab=records&symbol=005930`, 12의 종목 상세 링크). 필터를 바꾸면 쿼리도 맞춘다. 05의 다른 동작은 그대로 둔다.
- 360px에서 가로 스크롤 없이 보인다.

## 9. 테스트

- 계산: 국내 매수(수수료만), 국내 주식 매도(수수료+거래세), 국내 ETF 매도(거래세 0), 미국 매수·매도(수수료만, 0.01달러 버림), 원 미만 버림, 사용자 요율 적용.
- API: 기본값 조회(`isDefault: true`), 저장 후 조회, 되돌리기, 요율 범위·자릿수 `422`, 다른 사용자 설정이 섞이지 않음(사용자별 행), 추정 API의 ETF 판별(08b `kind`), PATCH로 수수료를 바꾸면 `costEstimated=false`.
- 마이그레이션 순환(`journal_0002`), 05 기존 테스트 전부 통과.
- 화면: 설정 저장·되돌리기, 매매 추가 다이얼로그의 초기값 채움과 사용자가 고친 값 유지, "추정" 배지, `/journal?tab=records&symbol=005930`으로 열면 그 종목으로 걸러진 기록.

## 10. 완료 기준

- AGENTS.md 공통 완료 기준(백엔드 ruff·pytest, 빈 DB 마이그레이션 순환, 프론트 lint·tsc·test·build, 360px).
- 기본 요율은 2절 값과 같고 코드 한 곳에만 있다.
- 스펙 끝에 `## 구현 결과`를 적는다.

## 11. 검증 체크리스트

1. 기본값 0.015%·0.20%·0.25%가 설정 화면과 API에 그대로 나온다.
2. 국내 주식 10주 × 70,000원 매도 추정이 수수료 105원(700,000 × 0.015% = 105)·거래세 1,400원이고, 같은 조건의 국내 ETF 매도는 거래세 0원이다.
3. 미국 10주 × 150.37달러 매수 추정 수수료가 3.75달러(1,503.70 × 0.25% = 3.75925 → 버림)다.
4. 요율을 바꾸면 이후 추정에 반영되고, 이미 저장된 거래는 바뀌지 않는다. 되돌리기 후 기본값이다.
5. 수동 입력에서 사용자가 고친 수수료·세금을 덮어쓰지 않는다. PATCH로 바꾼 거래는 `costEstimated=false`다.
6. 다른 사용자의 설정이 보이거나 바뀌지 않는다.
