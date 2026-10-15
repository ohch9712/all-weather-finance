# 14. 증권사 잔고를 자산배분에 자동 반영

> 웨이브 3 · 브랜치 `feature/14-holdings-sync` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 02(자산배분), 08(증권사 게이트웨이)이 develop에 병합된 상태.
> **착수 직전 갱신**: 코디네이터는 02의 `holdings` 실제 코드와 08 `## 구현 결과`의 `HOLDINGS` 구현 여부를 확인한다. 실제 어댑터가 하나도 잔고를 지원하지 않으면 Mock 전용으로 진행하고 그 사실을 적는다.

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
- `market.service.get_user_broker_client(db, user_id, connection_id).get_holdings()` → `upsert_synced_holdings(...)`
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

def upsert_synced_holdings(db, user_id, *, source: Literal["kiwoom", "toss", "codef"], connection_id: UUID,
                           items: list[SyncedHolding]) -> HoldingSyncResult
```

- `(connection_id, external_ref)`가 같은 행이 있으면 이름·금액·`synced_at`을 갱신한다. `class_override=false`일 때만 자산군을 다시 분류한다.
- 없으면 새로 만든다(`source`, `include_in_allocation=true`).
- 이번 목록에 없는 같은 연결의 기존 행은 삭제한다(`removed`).
- 08 결과의 예수금(`cash_krw`)은 `external_ref="__cash__"`, 이름 "예수금(<연결 별칭>)", `cash`.
- 금액은 0 이상 정수. 외화이고 원화 평가금액이 없으면 `skipped`.
- 끝나면 02의 점수 스냅샷 갱신을 호출한다.

### 6.3 02 코드 수정

- `PATCH /api/allocation/holdings/{id}`에서 동기화 행(`connection_id` 있음)의 `assetClass`를 바꾸면 `class_override=true`.
- 동기화 행의 `amount`·`name` 수정은 막는다(`409 CONFLICT`, "증권사에서 불러온 자산은 금액을 직접 바꿀 수 없어요. 다시 동기화해 주세요."). 삭제는 허용하되 다음 동기화에서 다시 생긴다고 안내한다.
- `Holding` 응답에 `connectionId`, `syncedAt`, `classOverride`를 더한다.

## 7. 화면 명세 (`/allocation/assets`)

- "증권사 잔고 불러오기" 버튼 → 다이얼로그: 활성 연결 선택(없으면 `/settings/connections` 안내) → 실행 → 결과 요약(추가·갱신·삭제·건너뜀 목록).
- 동기화 자산 행: 증권사 배지, 마지막 동기화 시각, 자동 분류 근거 툴팁, 분류를 바꿨으면 "직접 지정" 표시, 금액 수정 비활성.
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
