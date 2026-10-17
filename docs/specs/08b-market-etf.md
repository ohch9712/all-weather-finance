# 08b. 종목 마스터에 국내 ETF 추가

> 선행: 08(PR #9) 병합. 브랜치 `feature/08-market-etf`(develop에서 새로 만든다. 08 워크트리와 슬롯 08을 다시 쓴다). 12·13은 이 작업이 병합된 뒤 시작한다.
> 결정(2026-10-17, 사용자): 종목 검색·관심종목·조건검색의 대상은 **국내 주식 + 국내 ETF**다. 미국 주식·ETF는 별도 작업으로 미룬다(번호 미정).

## 1. 목표

- 08의 종목 마스터(`stocks`)와 일별 스냅샷(`stock_snapshots`)에 국내 ETF를 넣어, 종목 검색·상세·관심종목(12)·조건검색(13)에서 ETF를 다룰 수 있게 한다.
- 종목마다 종류(`kind`: `stock` 주식, `etf` ETF)를 구분해 응답에 싣는다.

## 2. 범위

| 포함 | 내용 |
| --- | --- |
| DB | `stocks.kind` 컬럼(revision `market_0002`) |
| 어댑터 | `StockInfo.kind`, capability `ETF_LIST`, `list_etfs()` (키움·Mock 구현, 토스는 공식 문서로 확인해 되면 구현, 아니면 미지원) |
| 배치 | `refresh-stocks`가 ETF 목록도 upsert, `refresh-snapshot`이 ETF 행도 수집 |
| API·서비스 | 검색의 `kind` 필터, 응답의 `kind` 필드, `SnapshotRow.kind` |
| Mock | 국내 ETF 10개 |

| 제외 | 이유 |
| --- | --- |
| 미국 주식·ETF(키움 `usa*` API) | 별도 작업. 시세 통화(USD)·환율·해외 스냅샷까지 범위가 커진다 |
| ETN·리츠·ELW 등 다른 시장 구분 | 이번 결정은 ETF까지다 |
| ETF 구성종목·NAV·괴리율 화면 | 12·13 범위 밖. 필요하면 별도 작업 |
| 화면 변경 | 08의 화면(`/settings/connections`)은 바꾸지 않는다. ETF 표시는 12·13이 한다 |

## 3. 소유 파일

- 08의 소유 파일과 같다: `backend/app/integrations/brokers/**`, `backend/app/modules/market/**`, `backend/tests/market/**`, `frontend/src/features/market/**`(타입만 바뀐다), `frontend/tests/market/**`
- `backend/alembic/versions/market_0002_*.py`
- 이 문서의 `## 구현 결과`

## 4. 어댑터 변경 (`integrations/brokers/base.py`)

```python
Capability = Literal["STOCK_LIST", "ETF_LIST", "FUNDAMENTALS", "QUOTES", "CANDLES", "HOLDINGS", "EXECUTIONS", "CONDITIONS"]

@dataclass(frozen=True)
class StockInfo:  code: str; name: str; market: Market; sector: str | None; kind: Literal["stock", "etf"] = "stock"

class BrokerClient(Protocol):
    ...
    def list_etfs(self) -> list[StockInfo]: ...   # kind="etf". ETF_LIST가 없으면 BROKER_NOT_SUPPORTED
```

- **키움**: `ka10099`(종목정보 리스트, `POST /api/dostk/stkinfo`)의 `mrkt_tp`에 `8 : ETF`가 있다(공식 저장소 `Kiwoom-Securities/Kiwoom-REST-API` 커밋 `953e5db`의 `kiwoom/_data/kiwoom_api_spec.json`에서 확인함, 2026-10-17). 응답 필드는 08의 `list_stocks`와 같은 방식으로 읽는다. 응답에 시장 정보가 있으면 그 값을 `market`에 쓰고, 없으면 `KOSPI`(국내 ETF는 유가증권시장 상장)로 둔다. 근거를 주석에 남긴다.
- **키움 ETF 지표**: 스냅샷에 넣을 가격·등락률·거래량·거래대금·시가총액은 공식 명세에서 확인한 API로 받는다. 후보는 `ka10001`(주식기본정보, ETF 코드도 되는지 확인)과 ETF 전용 `ka40002`(ETF종목정보)·`ka40004`(ETF전체시세)다. 어느 것을 썼는지와 필드 근거를 주석과 구현 결과에 적는다. 명세에 없는 값은 지어내지 않고 NULL로 둔다.
- **토스**: 공식 OpenAPI(08이 확인한 1.2.24)에서 ETF를 구분해 받을 수 있는지 확인한다. 확인되면 구현하고, 아니면 `ETF_LIST`를 capability에서 빼고 `BROKER_NOT_SUPPORTED`로 둔다.
- **Mock**: `fixtures/mock_stocks.json`에 국내 ETF 10개를 더한다(`kind: "etf"`). 실제 상장 ETF의 코드·이름을 쓰고(출처를 `fixtures/README.md`에 적는다), 지표 값은 08과 같이 고정 시드로 만든 가상값이다. 종류를 고르게 넣는다: 국내 대표지수 2, 해외지수 2, 채권 2, 금 1, 인버스 1, 레버리지 1, 배당 1. ETF의 `per`·`pbr`·`roe`·`eps`·`bps`·`foreignRatio`는 null이다.

## 5. DB (revision `market_0002`, `down_revision="market_0001"`, 같은 `market` 브랜치)

- `stocks.kind varchar(5) NOT NULL DEFAULT 'stock'`, CHECK `kind IN ('stock', 'etf')`.
- downgrade는 컬럼을 지운다. 빈 DB에서 `upgrade heads` → `downgrade base` → `upgrade heads`가 성공해야 한다.

## 6. 배치

- `refresh-stocks`: KOSPI·KOSDAQ(`kind=stock`)에 더해, 공급자에 `ETF_LIST`가 있으면 `list_etfs()` 결과를 `kind=etf`로 upsert한다. "목록에서 사라지면 `listed=false`"는 종류별로 판단한다(ETF 목록을 못 받은 실행에서 기존 ETF를 비상장으로 바꾸지 않는다).
- `refresh-snapshot`: 상장 ETF도 수집한다. 지표가 없는 칸은 NULL이다.
- `seed-mock`: 결과 90행(주식 80 + ETF 10).

## 7. API·서비스 변경

| 대상 | 변경 |
| --- | --- |
| `GET /api/market/stocks?q=&market=&kind=&limit=` | `kind`(선택, `stock`·`etf`, 그 외 `422`). 응답 항목에 `"kind"`를 더한다. 검색 순서 규칙은 08과 같다 |
| `GET /api/market/stocks/{code}` | `StockDetail`에 `"kind"`를 더한다. ETF의 `snapshot.per` 등은 null |
| `GET /api/market/snapshot/status` | `count`에 ETF가 포함된다 |
| `search_stocks(db, query, *, limit=20, kind=None)` | `kind` 인자 추가. `StockSummary`·`StockDetail`·`SnapshotRow`에 `kind` 필드 추가 |

- 기존 08 응답 필드는 그대로 두고 `kind`만 더한다(하위 호환).
- 프론트 `features/market/types.ts`의 종목 타입에 `kind: "stock" | "etf"`를 더한다.

## 8. 테스트

- 마이그레이션: `kind` 기본값 `stock`, CHECK, 순환.
- 어댑터: 키움 `ka10099 mrkt_tp=8` 요청 본문·파싱(`respx`), ETF 지표 API 파싱(확인한 API 기준), 토스 ETF 지원 여부에 맞는 동작, Mock `list_etfs` 10개 결정성.
- 배치: `seed-mock` 90행, ETF 목록을 못 받은 실행에서 기존 ETF가 비상장으로 바뀌지 않음, ETF 스냅샷의 지표 NULL.
- API: `kind` 필터·`422`, 응답의 `kind`, ETF 상세의 지표 null, 기존 08 테스트 전부 통과.

## 9. 완료 기준

- AGENTS.md 공통 완료 기준(백엔드 ruff·pytest, 빈 DB 마이그레이션 순환, 프론트 lint·tsc·test·build).
- 외부 API를 테스트에서 부르지 않는다. 공식 문서에서 확인한 api-id·경로·필드만 쓰고 출처를 주석에 남긴다.
- 스펙 끝에 `## 구현 결과`(어떤 API로 ETF 지표를 채웠는지, 토스 지원 여부, 스펙과 다른 점)를 적는다.

## 10. 검증 체크리스트

1. `stocks.kind`와 CHECK, `market_0002`의 순환이 된다.
2. `seed-mock` 후 `GET /api/market/stocks?q=KODEX&kind=etf`처럼 ETF가 검색되고, `kind=stock`이면 ETF가 빠진다.
3. ETF 상세의 `kind`가 `etf`이고 PER·PBR·ROE 등이 null이다(0으로 채우지 않는다).
4. 키움 ETF 목록·지표 매핑이 공식 명세 근거와 맞고, 확인하지 못한 기능은 `BROKER_NOT_SUPPORTED`다.
5. 기존 08 계약(경로·필드·상태코드)이 바뀌지 않았다.
