# 02. 자산배분: 투자성향 설문, 목표·상황, 목표 반영 권장 배분, 관리 방향과 추천 이유, 보유 자산, 배분 점수

> 웨이브 2 · 브랜치 `feature/02-allocation` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 01(develop 병합 완료). 공통 규칙 `AGENTS.md`, 이름 기준 `docs/architecture.md`.

## 1. 목표

- 증권사 방식의 투자성향 설문(6문항)으로 5등급 성향을 정한다.
- 나이대(01의 프로필)와 성향으로 25칸 권장 배분표에서 장기 투자 비중을 고른다.
- 사용자의 상황(월 생활비, 부양가족, 고금리 대출)과 목표(종류, 금액, 목표일)를 받아 **목표 반영 권장 배분**을 만든다. 비상금 → 3년 안 목표 자금 → 장기 투자 순서로 층을 쌓는다(5.8).
- 자산 현황·상황·목표에 맞는 **관리 방향**(먼저 할 일)과 **추천 이유**를 규칙으로 만들어 보여 준다(5.9·5.10). 같은 문장을 챗봇(15)과 홈(16)이 쓴다.
- 핵심 흐름: 가입 시 정보 입력(출생연도 → 투자성향 → 목표·상황 → 자산 간단 입력) → **추천 결과** → **상세 설명**.
- 보유 자산의 실제 비중을 계산하고, 목표 반영 권장 배분과의 일치 점수(0~100)·등급·리밸런싱 금액·점수 이력을 보여 준다. 점수와 등급, 지난번 대비 변화로 흥미를 끈다.

## 2. 범위

### 포함

- 설문 문항 제공 API, 진단 저장·최신 조회
- 상황(1건) 조회·저장, 목표 CRUD(최대 10개)
- 권장 배분 계산(표 값, 목표 반영), 25칸 표 API, 추천 API(관리 방향·추천 이유·답변별 점수)
- 보유 자산 CRUD(평가금액 기준)와 한 번에 여러 건 만들기(온보딩 간단 입력)
- 배분 리포트(상태별), 점수 일별 스냅샷과 이력
- 화면: `/allocation/survey`, `/allocation/situation`, `/allocation/assets`, `/allocation/recommendation`, `/allocation/recommendation/detail`, `/allocation`
- 다른 모듈용 서비스 함수(8절)

### 제외

| 항목 | 처리 |
| --- | --- |
| 증권사 잔고 자동 반영 | 14 |
| 수량·단가 기반 평가(시세 연동) | 범위 밖. 평가금액을 직접 입력한다 |
| 권장 비중을 사용자가 직접 고치기 | 범위 밖. 상황·목표를 바꾸면 규칙으로 다시 계산된다 |
| 목표 달성 가능성(월 적립액·예상 수익) 계산 | 범위 밖 |
| 특정 상품·종목 추천 | 만들지 않는다. 방향은 자산군 단위로만 안내한다 |
| 챗봇 도구 | 15 |

## 3. 소유 파일

- `backend/app/modules/allocation/**`
- `backend/alembic/versions/allocation_0001_*.py`
- `backend/tests/allocation/**`
- `frontend/src/app/(app)/allocation/**`(자리표시 3개를 교체)
- `frontend/src/features/allocation/**`
- `frontend/tests/allocation/**`
- 이 문서의 `## 구현 결과`

## 4. 기술 결정

| 항목 | 결정 |
| --- | --- |
| 설문·배분표 위치 | 백엔드 `modules/allocation/rules.py`의 상수. 프론트는 API로 받아 그린다(문항을 중복 정의하지 않는다) |
| 추천 계산 위치 | `modules/allocation/recommendation.py`의 순수 함수(입력: 표 비중·진단·상황·목표·보유 자산·오늘). DB와 시간을 직접 읽지 않는다 |
| 방향·이유 문구 | 백엔드가 5.9·5.10의 문장 틀로 만든다. 금액은 `app.core.format.format_krw_compact`, 퍼센트는 소수 첫째 자리(ROUND_HALF_UP) |
| 설문 버전 | `SURVEY_VERSION = 1`. 문항이 바뀌면 버전을 올린다 |
| 점수 반올림 | `Decimal` + `ROUND_HALF_UP` |
| 점수 이력 | 사용자·날짜(KST)당 한 행 upsert |
| 화면 차트 | 01b의 `DonutChart`, `BarChart`, `LineChart` 래퍼와 `--asset-*` 색 토큰 |

## 5. 도메인 규칙

### 5.1 투자성향 설문

| id | 문항 | 선택지(값: 표시) | 가중치 |
| --- | --- | --- | --- |
| `horizon` | 이 돈을 얼마 동안 투자할 수 있나요? | 1: 6개월 미만, 2: 6개월 ~ 1년, 3: 1년 ~ 3년, 4: 3년 ~ 5년, 5: 5년 이상 | 1.5 |
| `experience` | 지금까지 투자해 본 상품 중 가장 위험한 것은 무엇인가요? | 1: 예금·적금만 해 봤어요, 2: 채권, 채권형 펀드, 3: 혼합형 펀드, ELS 같은 파생결합증권, 4: 주식, 주식형 펀드, ETF, 5: 레버리지·인버스 ETF, 선물·옵션, 신용거래 | 1 |
| `knowledge` | 금융상품에 대해 얼마나 알고 있나요? | 1: 거의 모른다, 2: 예금과 펀드의 차이 정도는 안다, 3: 주식과 채권의 위험 차이를 설명할 수 있다, 4: 대부분의 금융상품 구조와 위험을 이해한다 | 1 |
| `income` | 앞으로의 수입은 어떨 것 같나요? | 1: 수입이 없거나 줄어들 것 같다, 2: 지금은 안정적이지만 앞으로 불안정할 것 같다, 3: 안정적으로 유지될 것 같다, 4: 꾸준히 늘어날 것 같다 | 1 |
| `investmentRatio` | 가진 금융자산 중 원금 손실이 날 수 있는 상품에 투자할 비중은 얼마인가요? | 1: 10% 이하, 2: 10% ~ 20%, 3: 20% ~ 30%, 4: 30% ~ 40%, 5: 40% 초과 | 1 |
| `lossTolerance` | 투자금이 1년 동안 어느 정도 손실이 나도 견딜 수 있나요? | 1: 원금은 꼭 지켜야 한다, 2: 10% 이내, 3: 20% 이내, 4: 30% 이내, 5: 기대 수익이 크다면 그 이상도 괜찮다 | 2 |

- 나이는 나이대로 따로 반영하므로 설문 점수에 넣지 않는다.
- 점수 = `100 × Σ(가중치 × (값 − 1) / (선택지 수 − 1)) ÷ Σ가중치`, 소수 첫째 자리까지(ROUND_HALF_UP). 가중치 합은 7.5다.
- 등급(금융투자협회 표준 구간): 20 이하 `stable`, 20 초과 40 이하 `stable_seeking`, 40 초과 60 이하 `neutral`, 60 초과 80 이하 `active`, 80 초과 `aggressive`.

검증용 사례

| 답(horizon, experience, knowledge, income, investmentRatio, lossTolerance) | 점수 | 등급 |
| --- | --- | --- |
| 1, 1, 1, 1, 1, 1 | 0.0 | stable |
| 1, 1, 1, 1, 1, 3 | 13.3 | stable |
| 3, 4, 3, 3, 3, 3 | 57.8 | neutral |
| 5, 5, 4, 4, 5, 1 | 73.3 | active |
| 5, 5, 4, 4, 5, 5 | 100.0 | aggressive |

### 5.2 권장 배분표

규칙(표를 만드는 근거이며, 테스트가 이 규칙으로 표를 다시 계산해 일치를 확인한다)

1. 대표나이: `20s` 25, `30s` 35, `40s` 45, `50s` 55, `60s` 65.
2. 성향 보정: `stable` −30, `stable_seeking` −15, `neutral` 0, `active` +10, `aggressive` +20.
3. 위험자산 = `clamp(100 − 대표나이 + 보정, 10, 90)`.
4. 기타 = `aggressive` 10, `active` 5, 나머지 0. 주식 = 위험자산 − 기타.
5. 안전자산 = 100 − 위험자산. 금 = 안전자산 40 초과면 10, 아니면 5. 현금 기본값 = `20s`·`30s` 5, `40s`·`50s` 10, `60s` 15. 현금 = `min(현금 기본값, 안전자산 − 금)`. 채권 = 안전자산 − 금 − 현금.

결과 표(주식 / 채권 / 금 / 현금 / 기타, %)

| 나이대 | 안정형 | 안정추구형 | 위험중립형 | 적극투자형 | 공격투자형 |
| --- | --- | --- | --- | --- | --- |
| 20대 | 45 / 40 / 10 / 5 / 0 | 60 / 30 / 5 / 5 / 0 | 75 / 15 / 5 / 5 / 0 | 80 / 5 / 5 / 5 / 5 | 80 / 0 / 5 / 5 / 10 |
| 30대 | 35 / 50 / 10 / 5 / 0 | 50 / 35 / 10 / 5 / 0 | 65 / 25 / 5 / 5 / 0 | 70 / 15 / 5 / 5 / 5 | 75 / 5 / 5 / 5 / 10 |
| 40대 | 25 / 55 / 10 / 10 / 0 | 40 / 40 / 10 / 10 / 0 | 55 / 25 / 10 / 10 / 0 | 60 / 20 / 5 / 10 / 5 | 65 / 10 / 5 / 10 / 10 |
| 50대 | 15 / 65 / 10 / 10 / 0 | 30 / 50 / 10 / 10 / 0 | 45 / 35 / 10 / 10 / 0 | 50 / 25 / 10 / 10 / 5 | 55 / 20 / 5 / 10 / 10 |
| 60대 이상 | 10 / 65 / 10 / 15 / 0 | 20 / 55 / 10 / 15 / 0 | 35 / 40 / 10 / 15 / 0 | 40 / 30 / 10 / 15 / 5 | 45 / 20 / 10 / 15 / 10 |

- `rules.py`에 이 표를 상수 `TARGET_TABLE[age_band][risk_profile] = {"stock": .., "bond": .., "gold": .., "cash": .., "other": ..}`로 둔다.
- 테스트: 25칸 모두 합 100, 모든 값 0 이상, 규칙 재계산 결과와 일치, 같은 성향에서 나이대가 오를수록 주식 비중이 늘지 않는다.

### 5.3 실제 비중

- 대상은 `include_in_allocation = true`이고 `amount > 0`인 보유 자산이다. 합계가 `totalAmount`, 제외된 자산 합계가 `excludedAmount`다.
- 자산군별 실제 비중 = 자산군 합계 ÷ `totalAmount` × 100(내부 계산은 `Decimal`, 응답은 소수 둘째 자리).

### 5.4 배분 점수와 등급

- 권장은 5.8의 목표 반영 권장 배분이다. 목표·상황이 없으면 5.2 표 값과 같다.
- 점수 = `100 − (Σ|실제 금액 − 권장 금액| ÷ totalAmount × 100) ÷ 2`(5개 자산군), 정수로 반올림(ROUND_HALF_UP). 범위 0~100. 비중으로 쓰면 `100 − Σ|실제 비중 − 권장 비중| ÷ 2`(퍼센트포인트)와 같은 값이다. 계산은 금액과 `Decimal`로 하고 중간에 반올림하지 않는다.
- 등급: 90 이상 S, 80 이상 A, 70 이상 B, 60 이상 C, 60 미만 D.
- 등급 메시지(화면용, 프론트 상수): S "권장 배분과 거의 같아요. 지금처럼 유지하세요.", A "아주 좋아요. 조금만 다듬으면 완벽해요.", B "조금만 조정하면 좋아요.", C "리밸런싱을 한 번 해 보면 좋겠어요.", D "권장 배분과 많이 달라요. 아래 안내를 참고하세요."

검증용 사례(권장 = 30대 위험중립형 65/25/5/5/0, 목표·상황 없음)

| 실제 비중(주식/채권/금/현금/기타) | 차이 합 | 점수 | 등급 |
| --- | --- | --- | --- |
| 65 / 25 / 5 / 5 / 0 | 0 | 100 | S |
| 50 / 30 / 0 / 20 / 0 | 40 | 80 | A |
| 0 / 0 / 0 / 100 / 0 | 190 | 5 | D |

### 5.5 리밸런싱 금액

- 자산군별 목표 금액 = 5.8의 권장 금액, 차이 금액 = 목표 금액 − 현재 금액. 양수는 "더 모으기", 음수는 "줄이기"로 표시한다.
- 매매를 권하는 문구가 아니라 비중 차이 안내라는 점을 화면에 적는다(`investment` 고지).

### 5.6 점수 스냅샷

- 리포트 상태가 `ready`로 계산될 때마다(`GET /report`, 보유 자산 생성·수정·삭제·일괄 생성, 진단 저장, 상황 저장, 목표 생성·수정·삭제 직후) 오늘(KST) 행을 upsert한다.
- `scoreDelta` = 오늘 점수 − 오늘보다 앞선 가장 최근 스냅샷 점수. 없으면 `null`.

### 5.7 상황과 목표

- 상황(사용자당 1건, 선택): 월 생활비(0~1억 원), 부양가족 수(0~10명, 본인 말고 생활비를 책임지는 가족), 고금리 대출 잔액(신용대출·카드론·현금서비스 등, 0~1조 원. 주택담보대출은 넣지 않는다).
- 목표(0~10개): 종류, 이름(1~30자, 비우면 종류 이름), 목표 금액(1원~1조 원), 목표일(오늘(KST) 다음 날 ~ 오늘 + 50년).

| 종류 `goalType` | 이름 |
| --- | --- |
| `retirement` | 노후 준비 |
| `home` | 내 집 마련 |
| `education` | 자녀 교육 |
| `marriage` | 결혼 자금 |
| `car` | 차량 구입 |
| `lump_sum` | 목돈 마련 |
| `other` | 기타 목표 |

- 목표 구분 `horizon`: 목표일 ≤ 오늘 + 1년이면 `within_1y`, ≤ 오늘 + 3년이면 `within_3y`, 그 뒤면 `long_term`. "오늘 + N년"은 같은 월·일이고 2월 29일은 2월 28일로 본다. 예: 오늘 2026-10-16이면 2027-10-16은 `within_1y`, 2029-10-16은 `within_3y`, 2029-10-17은 `long_term`.
- 비상금 개월 수 = 6(부양가족 1명 이상이거나 최신 진단의 `income` 답이 1·2), 아니면 3. 진단이 없으면 부양가족만 본다. 비상금 목표 = 월 생활비 × 개월 수.

### 5.8 목표 반영 권장 배분 (층 쌓기)

`T` = totalAmount(5.3). `T > 0`이면 아래 순서로 권장 금액을 정한다. 남은 금액은 `T`에서 시작해 층마다 줄어든다.

1. 비상금 층: 상황이 있으면 `min(비상금 목표, 남은 금액)`을 현금성 자산(`cash`)에 둔다.
2. 가까운 목표 층: `within_1y`·`within_3y` 목표를 목표일 순(같으면 만든 순)으로 보며 각각 `min(목표 금액, 남은 금액)`을 둔다. `within_1y`는 현금성 자산, `within_3y`는 채권(`bond`)이다.
3. 장기 투자 층: 남은 금액 `L`을 5.2 표 비중으로 나눈다. 주식·채권·금·기타는 `L × 비중 ÷ 100`을 원 단위로 반올림(ROUND_HALF_UP)하고, 현금성 자산은 `L`에서 네 값을 뺀 나머지다(층 합이 `L`과 정확히 같다).
4. 자산군별 권장 금액 = 세 층의 합(합계가 `T`와 같다). 권장 비중 = 권장 금액 ÷ `T` × 100, 응답은 소수 둘째 자리(ROUND_HALF_UP).

- `T = 0`이면 층을 계산하지 않는다(`layering: "needs_holdings"`). 권장 비중은 5.2 표 값이고 권장 금액은 없다.
- 상황과 목표가 모두 없으면 1·2층이 비어 결과가 5.2 표 값과 같다.

검증용 사례(오늘 2026-10-16, 금액 단위 원)

| 사례 | 입력 | 권장 금액(주식 / 채권 / 금 / 현금 / 기타) | 권장 비중 | 점수·등급 |
| --- | --- | --- | --- | --- |
| 1 | 30대 위험중립형, 상황·목표 없음. 보유: 주식 50,000,000 · 채권 30,000,000 · 현금 20,000,000 | 65,000,000 / 25,000,000 / 5,000,000 / 5,000,000 / 0 | 65.00 / 25.00 / 5.00 / 5.00 / 0.00 | 80 A |
| 2 | 30대 위험중립형(`income` 3). 상황: 생활비 2,000,000, 부양 0, 대출 0. 목표: 내 집 마련 20,000,000(2028-10-16), 노후 준비 500,000,000(2056-10-16). 보유: 주식 26,000,000 · 채권 6,000,000 · 현금 20,000,000, 실거주 주택 300,000,000(제외) | 16,900,000 / 26,500,000 / 1,300,000 / 7,300,000 / 0 | 32.50 / 50.96 / 2.50 / 14.04 / 0.00 | 58 D |
| 3 | 40대 적극투자형(`income` 3). 상황: 생활비 3,000,000, 부양 1(6개월, 비상금 18,000,000). 보유: 주식 10,000,000 | 0 / 0 / 0 / 10,000,000 / 0 | 0.00 / 0.00 / 0.00 / 100.00 / 0.00 | 0 D |
| 4 | 20대 공격투자형(`income` 2, 6개월). 상황: 생활비 1,500,000(비상금 9,000,000), 대출 5,000,000. 목표: 결혼 자금 10,000,000(2027-06-30). 보유: 주식 30,000,000 · 현금 5,000,000 · 기타(리츠) 5,000,000 | 16,800,000 / 0 / 1,050,000 / 20,050,000 / 2,100,000 | 42.00 / 0.00 / 2.63 / 50.13 / 5.25 | 60 C |

- 사례 2의 층: 비상금 6,000,000(현금), 내 집 마련 20,000,000(채권, `within_3y`), 장기 26,000,000(주식 16,900,000 · 채권 6,500,000 · 금 1,300,000 · 기타 0 · 현금 나머지 1,300,000). 노후 준비는 `long_term`이라 층이 없다.
- 사례 4의 차이 합은 32,200,000원이고 `100 − 80.5 ÷ 2 = 59.75`를 반올림해 60점이다(반올림 경계 확인용).
- 사례 3은 비상금 목표(18,000,000)가 자산(10,000,000)보다 커서 자산 전부가 현금성 자산이다.

### 5.9 관리 방향 (`directions`)

아래 규칙에 맞는 항목을 `priority` 순서로 모두 만든다. 같은 `priority`는 표에 적힌 순서, 같은 종류가 여러 개면 목표일 순(5.8의 2와 같다)이다. 화면 "먼저 할 일"은 앞 3개, 상세 설명은 전부 보여 준다.

| priority | kind | 조건 | title | body | amount | assetClass | href |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `pay_consumer_debt` | 고금리 대출 > 0 | 고금리 대출부터 갚아요 | 신용대출·카드론 같은 대출이 {대출}이에요. 이런 대출의 이자는 보통 투자로 기대할 수 있는 수익보다 높아서, 투자를 늘리기 전에 갚는 것을 먼저 검토하는 것이 일반적이에요. | 대출 잔액 | `null` | `/allocation/situation` |
| 2 | `build_emergency_fund` | 상황 있음, 현금성 자산 실제 금액 < 비상금 목표 | 비상금을 먼저 채워요 | 생활비 {생활비}의 {N}개월치인 {비상금 목표}를 현금성 자산으로 두는 것을 권해요. 지금 현금성 자산은 {현금}이라 {부족액}이 부족해요. | 부족액 | `cash` | `/allocation/assets` |
| 3 | `reserve_short_term_goal` | `within_1y`·`within_3y` 목표마다 | '{이름}' 자금은 안전하게 | {YYYY년 M월}에 쓸 {층 금액}은 값이 크게 흔들리지 않는 {현금성 자산 \| 채권}으로 모아 두는 것을 권해요. | 층 금액 | `cash` \| `bond` | `/allocation/recommendation/detail` |
| 4 | `rebalance` | `T > 0`이고 \|실제 − 권장\|이 5%p 이상인 자산군 중 차이가 큰 2개(같으면 자산군 순서) | {자산군} 비중을 {줄여요 \| 늘려요} | 지금 {자산군} 비중은 {실제}%로 권장 {권장}%보다 {차이}%p {높아요 \| 낮아요}. 약 {차이 금액}을 {줄이면 \| 더 모으면} 권장 배분에 가까워져요. | \|차이 금액\| | 자산군 | `/allocation` |
| 4 | `keep_allocation` | `T > 0`이고 5%p 이상 차이 나는 자산군이 없음 | 지금 배분을 유지해요 | 모든 자산군이 권장 비중과 5%p 안쪽이에요. 6개월에 한 번쯤 다시 점검해 보세요. | `null` | `null` | `/allocation` |
| 5 | `long_term_goal` | `long_term` 목표마다 | '{이름}'은 장기 투자로 준비해요 | {YYYY년 M월}까지 시간이 넉넉해서 장기 투자 몫(권장 배분)으로 꾸준히 모으는 방식이 어울려요. | `null` | `null` | `/allocation/recommendation/detail` |
| 6 | `input_situation` | 상황 없음 | 생활비를 알려 주세요 | 월 생활비를 입력하면 비상금 목표를 계산해 권장 배분에 반영해요. | `null` | `null` | `/allocation/situation` |
| 6 | `input_holdings` | `T = 0` | 보유 자산을 입력해 주세요 | 자산을 입력하면 배분 점수와 조정할 금액을 알려 드려요. | `null` | `null` | `/allocation/assets` |

- `T = 0`이면 `build_emergency_fund`의 body는 "생활비 {생활비}의 {N}개월치인 {비상금 목표}를 비상금으로 먼저 모아 두세요."이고 amount는 비상금 목표다. `reserve_short_term_goal`의 금액은 목표 금액이다.
- `{대출}`·`{비상금 목표}` 같은 금액은 `format_krw_compact`, `{실제}`·`{권장}`·`{차이}`는 소수 첫째 자리 퍼센트(`{차이}`는 반올림한 `{실제}`와 `{권장}`의 차이의 절댓값이라 문장 안 계산이 맞아떨어진다. `{차이 금액}`도 절댓값이고 방향은 "높아요·낮아요"로 말한다), `{YYYY년 M월}`은 목표일의 연·월이다. 예: "지금 채권 비중은 11.5%로 권장 51.0%보다 39.5%p 낮아요. 약 2,050만원을 더 모으면 권장 배분에 가까워져요."
- 5%p 비교와 차이가 큰 순서는 반올림 전 값 `(실제 금액 − 권장 금액) ÷ T × 100`으로 정한다.
- 투자 권유 표현("사세요", "매수하세요", "팔아요")을 쓰지 않는다. 금액은 비중 차이를 알려 주는 참고값이다.

5.8 사례의 방향(kind, amount, assetClass, 문장의 실제 → 권장 비중과 차이)

| 사례 | directions |
| --- | --- |
| 1 | `rebalance` 15,000,000 `stock`(50.0% → 65.0%, 15.0%p 낮음, 늘려요) → `rebalance` 15,000,000 `cash`(20.0% → 5.0%, 15.0%p 높음, 줄여요) → `input_situation` |
| 2 | `reserve_short_term_goal` 20,000,000 `bond` → `rebalance` 20,500,000 `bond`(11.5% → 51.0%, 39.5%p 낮음) → `rebalance` 12,700,000 `cash`(38.5% → 14.0%, 24.5%p 높음) → `long_term_goal`('노후 준비') |
| 3 | `build_emergency_fund` 18,000,000 `cash` → `rebalance` 10,000,000 `stock`(100.0%p 높음) → `rebalance` 10,000,000 `cash`(100.0%p 낮음) |
| 4 | `pay_consumer_debt` 5,000,000 → `build_emergency_fund` 4,000,000 `cash` → `reserve_short_term_goal` 10,000,000 `cash` → `rebalance` 15,050,000 `cash`(12.5% → 50.1%, 37.6%p 낮음) → `rebalance` 13,200,000 `stock`(75.0% → 42.0%, 33.0%p 높음) |
| 자산 없음(30대 위험중립형, 생활비 2,000,000) | `build_emergency_fund` 6,000,000 `cash` → `input_holdings` |

- 사례 2의 첫 방향 body: "2028년 10월에 쓸 2,000만원은 값이 크게 흔들리지 않는 채권으로 모아 두는 것을 권해요."
- 사례 4의 둘째 방향 body: "생활비 150만원의 6개월치인 900만원을 현금성 자산으로 두는 것을 권해요. 지금 현금성 자산은 500만원이라 400만원이 부족해요."

### 5.10 추천 이유 (`reasons`, `assetClassNotes`, `answerContributions`)

`reasons`는 아래 순서로 조건에 맞는 것만 만든다.

| code | 조건 | title | body |
| --- | --- | --- | --- |
| `age_band` | 항상 | 나이대: {30대} | 투자할 수 있는 기간이 길수록 위험자산(주식+기타) 비중을 높게 잡아요. 대표 나이 {35}세 기준 출발점은 100 − {35} = {65}%예요. |
| `risk_profile` | 항상 | 투자성향: {위험중립형}({57.8}점) | {성향 한 줄 설명} 그래서 위험자산 비중을 {+0}%p 조정했어요. 투자 기간은 '{horizon 답}', 견딜 수 있는 손실은 '{lossTolerance 답}'이라고 답했고, 이 두 문항이 점수에 가장 크게 반영돼요. {제한 문장} |
| `emergency_fund` | 상황 있음 | 비상금: {비상금 목표} | 생활비 {생활비}의 {N}개월치를 현금성 자산으로 먼저 떼어 두었어요. 부양가족이 있거나 앞으로 수입이 불안정할 것 같다고 답하면 6개월치로 늘려요. |
| `short_term_goals` | `within_1y`·`within_3y` 목표가 있음 | 가까운 목표 자금: {층 합계} | 3년 안에 쓸 돈은 값이 크게 흔들리지 않게 1년 안이면 현금성 자산, 1~3년이면 채권으로 잡았어요. {목표마다 "'{이름}' {YYYY년 M월} {층 금액}({자산군})"을 ", "로 이어 붙임} |
| `long_term_mix` | `T > 0` | 장기 투자 몫: {L} | 나머지는 나이대·성향 표 비중대로 주식 {s}% · 채권 {b}% · 금 {g}% · 현금성 자산 {c}% · 기타 {o}%로 나눴어요. |

- `{성향 한 줄 설명}`은 `rules.RISK_PROFILE_SUMMARY`(9.1의 다섯 문장)다. 보정 표기는 `+10`, `-15`처럼 부호를 붙인다. 보정이 0이면 "그래서 위험자산 비중을 {+0}%p 조정했어요." 대신 "그래서 위험자산 비중을 따로 조정하지 않았어요."를 쓴다.
- `{제한 문장}`: 위험자산이 10~90%로 잘렸으면 "위험자산 비중은 10~90% 사이로 제한해 {최종}%로 정했어요.", 아니면 "위험자산 비중은 {최종}%예요."
- `emergency_fund`에서 `T > 0`이고 비상금 목표가 `T`보다 크면 끝에 " 지금 자산이 비상금 목표보다 적어 자산 전부를 현금성 자산으로 잡았어요."를 붙인다. `T = 0`이면 `short_term_goals`의 금액은 목표 금액이고 끝에 " 자산을 입력하면 권장 배분에 반영해요."를 붙인다.
- `T = 0`이면 `long_term_mix` 대신 title "장기 투자 비중", body "자산을 입력하면 비상금과 가까운 목표 자금을 뺀 나머지를 이 비중으로 나눠요: 주식 {s}% · 채권 {b}% · 금 {g}% · 현금성 자산 {c}% · 기타 {o}%."를 만든다.

`assetClassNotes`는 항상 5개(자산군 순서)다. `weight`는 권장 비중이다.

| 자산군 | note |
| --- | --- |
| `stock` | 기업의 성장에 투자해요. 오래 둘수록 기대 수익이 크지만 값이 크게 오르내려요. |
| `bond` | 정해진 이자를 받으며, 주식이 흔들릴 때 전체 자산의 변동을 줄여 줘요. |
| `gold` | 물가가 오르거나 시장이 불안할 때 다른 자산과 다르게 움직여 분산 효과가 있어요. |
| `cash` | 비상금과 곧 쓸 돈이에요. 손실 위험은 거의 없지만 물가만큼 불어나기는 어려워요. |
| `other` | 리츠·원자재처럼 주식·채권과 다르게 움직이는 자산이에요. 공격적인 성향에서만 조금 담아요. |

`answerContributions`는 설문 6문항 순서다: `points` = `100 × 가중치 × (값 − 1) ÷ (선택지 수 − 1) ÷ 7.5`, `maxPoints` = `100 × 가중치 ÷ 7.5`, 둘 다 소수 첫째 자리(ROUND_HALF_UP). 문항마다 따로 반올림하므로 합이 진단 점수와 0.1점 다를 수 있다. 화면은 합계로 진단 점수(`riskScore`)를 보여 준다.

| 답 | points(horizon, experience, knowledge, income, investmentRatio, lossTolerance) | 합 | 진단 점수 |
| --- | --- | --- | --- |
| 3, 4, 3, 3, 3, 3 | 10.0, 10.0, 8.9, 8.9, 6.7, 13.3 | 57.8 | 57.8 |
| 5, 5, 4, 4, 5, 1 | 20.0, 13.3, 13.3, 13.3, 13.3, 0.0 | 73.2 | 73.3 |

- `maxPoints`: 20.0, 13.3, 13.3, 13.3, 13.3, 26.7.

## 6. DB 스키마 (revision `allocation_0001`, `branch_labels=("allocation",)`)

### 6.1 `risk_assessments`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `survey_version` | `smallint` | NOT NULL |
| `answers` | `jsonb` | NOT NULL. 키는 5.1의 id(camelCase 그대로) |
| `score` | `numeric(4,1)` | NOT NULL, CHECK 0~100 |
| `risk_profile` | `varchar(16)` | NOT NULL, CHECK 5개 값 |
| `created_at` | `timestamptz` | NOT NULL, default now() |

인덱스 `(user_id, created_at desc)`.

### 6.2 `holdings`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `name` | `varchar(50)` | NOT NULL |
| `asset_class` | `varchar(8)` | NOT NULL, CHECK `stock, bond, gold, cash, other` |
| `amount` | `bigint` | NOT NULL, CHECK `amount >= 0` |
| `include_in_allocation` | `boolean` | NOT NULL, default true |
| `source` | `varchar(16)` | NOT NULL, default `'manual'`, CHECK `manual, kiwoom, toss, codef` |
| `memo` | `varchar(200)` | NULL |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

인덱스 `(user_id)`. 14가 `allocation_0002`에서 `external_ref`, `connection_id`, `synced_at`, `class_override` 컬럼을 추가한다.

### 6.3 `allocation_scores`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `scored_on` | `date` | NOT NULL |
| `score` | `smallint` | NOT NULL, CHECK 0~100 |
| `grade` | `varchar(1)` | NOT NULL, CHECK `S, A, B, C, D` |
| `total_amount` | `bigint` | NOT NULL |
| `actual_weights`, `target_weights` | `jsonb` | NOT NULL. `target_weights`는 5.8 목표 반영 권장 비중(소수 둘째 자리 숫자) |
| `age_band` | `varchar(4)` | NOT NULL |
| `risk_profile` | `varchar(16)` | NOT NULL |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

UNIQUE `(user_id, scored_on)`.

### 6.4 `allocation_situations`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `user_id` | `uuid` | PK, FK users ON DELETE CASCADE |
| `monthly_expense` | `bigint` | NOT NULL, CHECK 0~100,000,000 |
| `dependents` | `smallint` | NOT NULL, default 0, CHECK 0~10 |
| `consumer_debt` | `bigint` | NOT NULL, default 0, CHECK 0~1,000,000,000,000 |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

### 6.5 `financial_goals`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `goal_type` | `varchar(16)` | NOT NULL, CHECK 5.7의 7개 값 |
| `title` | `varchar(30)` | NOT NULL |
| `target_amount` | `bigint` | NOT NULL, CHECK 1~1,000,000,000,000 |
| `target_date` | `date` | NOT NULL |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

인덱스 `(user_id, target_date)`. 사용자당 10개 제한은 서비스에서 검사한다.

## 7. API 계약 (모두 인증 필요)

### 7.1 `GET /api/allocation/survey`

```json
{ "version": 1,
  "questions": [
    { "id": "horizon", "text": "이 돈을 얼마 동안 투자할 수 있나요?",
      "options": [ { "value": 1, "label": "6개월 미만" }, { "value": 2, "label": "6개월 ~ 1년" } ] } ] }
```

문항 순서와 문구는 5.1 표 그대로다.

### 7.2 `POST /api/allocation/risk-assessments`

- 요청: `{"surveyVersion": 1, "answers": {"horizon": 3, "experience": 4, "knowledge": 3, "income": 3, "investmentRatio": 3, "lossTolerance": 3}}`
- 6개 키가 모두 있어야 하고 값은 선택지 범위 안의 정수다. 어기면 `422`(`field`는 키 이름, `message` "선택지를 다시 골라 주세요."). `surveyVersion`이 현재 버전이 아니면 `422`(`field: "surveyVersion"`, "설문이 바뀌었습니다. 새로고침해 주세요.").
- 성공 `201`: `{"id": "...", "score": 57.8, "riskProfile": "neutral", "createdAt": "..."}`. 점수 스냅샷을 갱신한다(5.6).

### 7.3 `GET /api/allocation/risk-assessments/latest`

- `200 {"assessment": {"id": "...", "score": 57.8, "riskProfile": "neutral", "answers": {...}, "createdAt": "..."}}`, 진단 기록이 없으면 `{"assessment": null}`.

### 7.4 `GET /api/allocation/target`

- 나이대·성향 표 값(5.2)이다. 상황·목표를 반영한 값은 7.10이다.

- `200 {"ageBand": "30s", "riskProfile": "neutral", "weights": {"stock": 65, "bond": 25, "gold": 5, "cash": 5, "other": 0}, "riskyWeight": 65, "explanation": "30대 위험중립형: 위험자산 비중 = 100 − 35 + 0 = 65%"}`
- 출생연도 없음 `409 PROFILE_INCOMPLETE`("출생연도를 먼저 입력해 주세요."), 진단 없음 `409 RISK_PROFILE_REQUIRED`("투자성향 진단을 먼저 해 주세요.").

### 7.5 `GET /api/allocation/targets/table`

- `200 {"rows": [{"ageBand": "20s", "cells": [{"riskProfile": "stable", "weights": {...}}, ...]}, ...]}`. 5.2 표 전체. 인증만 필요하다.

### 7.6 보유 자산

| 메서드·경로 | 요청 | 성공 |
| --- | --- | --- |
| `GET /api/allocation/holdings` | | `200 {"items": [Holding...]}` 생성순 |
| `POST /api/allocation/holdings` | `{"name": "비상금 통장", "assetClass": "cash", "amount": 5000000, "includeInAllocation": true, "memo": null}` | `201 Holding` |
| `PATCH /api/allocation/holdings/{id}` | 위 필드 중 일부 | `200 Holding` |
| `DELETE /api/allocation/holdings/{id}` | | `204` |

- `Holding`: `{"id", "name", "assetClass", "amount", "includeInAllocation", "source", "memo", "createdAt", "updatedAt"}`
- 검증: `name` 앞뒤 공백 제거 후 1~50자, `assetClass` 5개 값, `amount` 0 이상 1조 이하 정수, `memo` 200자 이하.
- 남의 자산이나 없는 id는 `404`. 변경 후 점수 스냅샷을 갱신한다.
- `POST /api/allocation/holdings/bulk`(온보딩 간단 입력): 요청 `{"items": [ {"name": "예금·현금", "assetClass": "cash", "amount": 20000000, "includeInAllocation": true, "memo": null} ]}`, 1~20개. 성공 `201 {"items": [Holding...]}`(요청 순서). 한 항목이라도 검증에 실패하면 아무것도 저장하지 않고 `422`(`field`는 `items.0.amount`처럼 위치를 붙인다). 스냅샷은 한 번만 갱신한다.

### 7.7 `GET /api/allocation/report`

```json
{
  "status": "ready",
  "ageBand": "30s",
  "riskProfile": "neutral",
  "totalAmount": 52000000,
  "excludedAmount": 300000000,
  "score": 58,
  "grade": "D",
  "scoreDelta": 3,
  "scoredOn": "2026-10-16",
  "classes": [
    { "assetClass": "stock", "actualAmount": 26000000, "actualWeight": 50.0, "targetWeight": 32.5, "targetAmount": 16900000, "diffAmount": -9100000 }
  ]
}
```

- `status` 판정 순서: 출생연도 없음 `needs_profile` → 진단 없음 `needs_assessment` → 배분 대상 자산 합계 0 `needs_holdings` → `ready`.
- `classes`는 항상 5개, 순서는 `stock, bond, gold, cash, other`. `targetWeight`·`targetAmount`는 5.8 목표 반영 권장 값이다(`targetWeight`는 소수 둘째 자리 숫자). `ready`가 아니면 `score`, `grade`, `scoreDelta`, `scoredOn`, `classes`는 `null`이고, 알 수 있는 `ageBand`·`riskProfile`·`totalAmount`·`excludedAmount`만 채운다.

### 7.8 `GET /api/allocation/scores?days=180`

- `days` 1~730(기본 180). `200 {"items": [{"scoredOn": "2026-10-01", "score": 72, "grade": "B"}]}` 날짜 오름차순.

### 7.9 상황과 목표

| 메서드·경로 | 요청 | 성공 |
| --- | --- | --- |
| `GET /api/allocation/situation` | | `200 {"situation": Situation \| null}` |
| `PUT /api/allocation/situation` | `{"monthlyExpense": 2000000, "dependents": 0, "consumerDebt": 0}` | `200 Situation` |
| `GET /api/allocation/goals` | | `200 {"items": [Goal...]}` 목표일 순(같으면 만든 순) |
| `POST /api/allocation/goals` | `{"goalType": "home", "title": "내 집 마련", "targetAmount": 20000000, "targetDate": "2028-10-16"}` | `201 Goal` |
| `PATCH /api/allocation/goals/{id}` | 위 필드 중 일부 | `200 Goal` |
| `DELETE /api/allocation/goals/{id}` | | `204` |

- `Situation`: `{"monthlyExpense", "dependents", "consumerDebt", "emergencyMonths", "emergencyTarget", "updatedAt"}`(개월 수·목표는 5.7로 계산)
- `Goal`: `{"id", "goalType", "title", "targetAmount", "targetDate", "horizon", "createdAt", "updatedAt"}`(`horizon`은 오늘 기준 5.7 구분)
- 검증은 5.7 범위를 따른다. 어기면 `422`(`field`는 키 이름). `title`은 앞뒤 공백을 지우고, 비면 종류 이름으로 저장한다. 11번째 목표 만들기는 `422`(`field: "goals"`, "목표는 10개까지 만들 수 있어요.").
- 남의 목표나 없는 id는 `404`. 저장·삭제 후 점수 스냅샷을 갱신한다.

### 7.10 `GET /api/allocation/recommendation`

```json
{
  "status": "ready",
  "layering": "applied",
  "ageBand": "30s", "riskProfile": "neutral", "riskScore": 57.8,
  "riskProfileSummary": "수익과 위험의 균형을 원해요.",
  "risky": { "start": 65, "adjustment": 0, "final": 65, "clamped": false },
  "baseWeights": { "stock": 65, "bond": 25, "gold": 5, "cash": 5, "other": 0 },
  "totalAmount": 52000000,
  "layers": {
    "emergency": { "monthlyExpense": 2000000, "months": 3, "targetAmount": 6000000, "allocatedAmount": 6000000 },
    "shortTermGoals": [ { "goalId": "…", "title": "내 집 마련", "targetDate": "2028-10-16", "horizon": "within_3y",
                          "targetAmount": 20000000, "allocatedAmount": 20000000, "assetClass": "bond" } ],
    "longTermAmount": 26000000
  },
  "targetAmounts": { "stock": 16900000, "bond": 26500000, "gold": 1300000, "cash": 7300000, "other": 0 },
  "targetWeights": { "stock": 32.5, "bond": 50.96, "gold": 2.5, "cash": 14.04, "other": 0.0 },
  "directions": [ { "kind": "reserve_short_term_goal", "priority": 3, "title": "'내 집 마련' 자금은 안전하게",
                    "body": "2028년 10월에 쓸 2,000만원은 값이 크게 흔들리지 않는 채권으로 모아 두는 것을 권해요.",
                    "amount": 20000000, "assetClass": "bond", "href": "/allocation/recommendation/detail" } ],
  "reasons": [ { "code": "age_band", "title": "나이대: 30대", "body": "…" } ],
  "assetClassNotes": [ { "assetClass": "stock", "weight": 32.5, "note": "…" } ],
  "answerContributions": [ { "questionId": "horizon", "question": "이 돈을 얼마 동안 투자할 수 있나요?",
                             "answerLabel": "1년 ~ 3년", "points": 10.0, "maxPoints": 20.0 } ]
}
```

- `status`: 출생연도 없음 `needs_profile` → 진단 없음 `needs_assessment` → `ready`. `ready`가 아니면 `status`만 채우고 나머지 값은 `null`이나 빈 배열이다.
- `layering`: `applied`(`T > 0`) / `needs_holdings`(`T = 0`). `needs_holdings`면 `targetAmounts`·`layers.longTermAmount`·각 `allocatedAmount`가 `null`이고 `targetWeights`는 표 값이다.
- `layers.emergency`는 상황이 없으면 `null`, `shortTermGoals`는 없으면 빈 배열이다.
- 이 API는 점수 스냅샷을 쓰지 않는다(부수 효과 없음).

## 8. 다른 모듈용 서비스 함수

```python
# app/modules/allocation/service.py
@dataclass(frozen=True)
class RiskProfileInfo:
    risk_profile: RiskProfile
    score: Decimal
    assessed_at: datetime

@dataclass(frozen=True)
class TargetAllocation:
    age_band: AgeBand
    risk_profile: RiskProfile
    weights: dict[AssetClass, int]

@dataclass(frozen=True)
class AssetBreakdown:
    included_by_class: dict[AssetClass, int]   # 배분 대상(포함, 금액 > 0) 자산군별 합계. 5개 키 항상
    included_total: int
    excluded_total: int                         # 점수 계산에서 뺀 자산 합계(실거주 주택 등)

def get_latest_risk_profile(db, user_id) -> RiskProfileInfo | None
def get_target_allocation(db, user_id) -> TargetAllocation        # 5.2 표 값. AppError 409 PROFILE_INCOMPLETE / RISK_PROFILE_REQUIRED
def get_recommendation(db, user_id) -> Recommendation             # 7.10과 같은 내용의 Pydantic 모델. 스냅샷을 쓰지 않는다
def get_allocation_report(db, user_id) -> AllocationReport        # 7.7과 같은 내용의 Pydantic 모델
def get_asset_breakdown(db, user_id) -> AssetBreakdown
```

- 15(챗봇 도구)가 `get_allocation_report`·`get_recommendation`을, 16(대시보드)이 `get_allocation_report`·`get_recommendation`(첫 번째 방향)을, 06(상속세 추정·방향 비교의 사전 채움)이 `get_asset_breakdown`을 쓴다.
- `get_allocation_report`는 부수 효과로 스냅샷을 upsert한다. 호출한 쪽이 트랜잭션을 커밋한다(라우터는 커밋한다).

## 9. 화면 명세

온보딩 흐름(`?onboarding=1`): 01b `/onboarding`(출생연도) → 투자성향(`/allocation/survey`, 1/3) → 목표·상황(`/allocation/situation`, 2/3) → 자산 간단 입력(`/allocation/assets`, 3/3) → 추천 결과(`/allocation/recommendation`) → 상세 설명(`/allocation/recommendation/detail`). 온보딩 단계 화면 위에는 진행 표시("1/3 투자성향")를 둔다. 목표·상황과 자산 입력은 건너뛸 수 있다.

### 9.1 `/allocation/survey`

- 한 화면에 한 문항, 진행률 표시(1/6), 이전·다음 버튼. 마지막에 "결과 보기".
- 제출(`POST /risk-assessments`) 후 `?onboarding=1`이면 `/allocation/situation?onboarding=1`, 아니면 `/allocation/recommendation`으로 간다.
- 성향 한 줄 설명은 백엔드 `rules.RISK_PROFILE_SUMMARY`가 기준이고 7.10의 `riskProfileSummary`로 받는다: 안정형 "원금 보전이 가장 중요해요.", 안정추구형 "손실은 작게, 이자보다 조금 높은 수익을 원해요.", 위험중립형 "수익과 위험의 균형을 원해요.", 적극투자형 "높은 수익을 위해 손실도 어느 정도 감수해요.", 공격투자형 "큰 수익을 위해 큰 손실도 감수할 수 있어요."

### 9.2 `/allocation`

- 상태별 화면
  - `needs_assessment`: 안내와 "투자성향 진단하기" 버튼
  - `needs_holdings`: 내 권장 배분 도넛 + "보유 자산 입력하기" 버튼
  - `ready`: 아래 전부
- 점수 카드: 큰 점수, 등급 배지, 등급 메시지, `scoreDelta`(▲3 / ▼2, 없으면 숨김).
- 도넛 두 개(목표 반영 권장 / 내 자산), 자산군 색은 `--asset-*`.
- 자산군별 차이 막대(실제 − 권장, 0 기준 좌우), 리밸런싱 표(자산군, 현재 금액, 목표 금액, 차이 "+780만원 더 모으기"/"-120만원 줄이기").
- 점수 이력 선 그래프(`GET /scores`), 데이터 2개 미만이면 숨김.
- "추천 결과 보기"(`/allocation/recommendation`)와 "왜 이렇게 추천했나요?"(`/allocation/recommendation/detail`) 링크, "나이대·성향별 표 보기" 다이얼로그(7.5 표, 내 칸 강조).
- 하단 `Disclaimer variant="investment"`. 제외 자산이 있으면 "점수 계산에서 뺀 자산 3억원" 안내.

### 9.3 `/allocation/assets`

- 자산군별로 묶은 목록(자산군 합계와 비중), 항목: 이름, 금액(`MoneyText`), 제외 여부 배지, 출처 배지(`manual` 외에는 "증권사 연동").
- 추가·수정 다이얼로그: 이름, 자산군 선택, 금액(숫자 입력 + "만원" 단위 도우미 표시), 점수 계산 포함 스위치, 메모.
- 빠른 추가 버튼: 예금·적금(cash), 비상금(cash), 국내주식(stock), 해외주식(stock), 채권 ETF(bond), 금 ETF(gold), 리츠(other), 실거주 주택(other, 제외로 기본 설정).
- 삭제 확인(`ConfirmDialog`). 변경 후 리포트·추천·점수 쿼리를 무효화한다.
- `?onboarding=1`이고 보유 자산이 없으면 목록 대신 "간단 입력" 카드를 보여 준다: 예금·현금(cash), 주식·주식형 펀드(stock), 채권·채권형 펀드(bond), 금(gold), 리츠 등 기타(other), 실거주 주택(other, 점수 계산 제외) 6줄의 금액 입력. 0보다 큰 줄만 줄 이름을 자산 이름으로 `POST /holdings/bulk`에 보내고 `/allocation/recommendation?onboarding=1`로 간다. "건너뛰기"도 같은 곳으로 간다. 이미 자산이 있으면 목록과 "다음" 버튼을 보여 준다.

### 9.4 `/allocation/situation`

- 상황 폼: 월 생활비(만원 도우미), 부양가족 수(0~10 `Select`), 고금리 대출 잔액(도움말 "신용대출·카드론·현금서비스 등. 주택담보대출은 넣지 않아요."). 저장 시 비상금 개월 수와 목표 금액을 바로 보여 준다("비상금 목표: 600만원(3개월)").
- 목표 목록: 카드(종류, 이름, 금액, 목표일, 구분 배지 "1년 안"/"3년 안"/"장기"). 추가·수정 다이얼로그(종류 칩 7개, 이름, 금액, 목표일), 삭제 확인. 10개면 추가 버튼을 끈다.
- `?onboarding=1`: "다음"(입력한 것을 저장하고 `/allocation/assets?onboarding=1`), "건너뛰기"(저장하지 않고 이동). 아니면 "저장" 후 `/allocation/recommendation`.

### 9.5 `/allocation/recommendation` (추천 결과)

- 제목 "내 추천 결과". 칩: 나이대, 성향(점수), 비상금 개월 수(상황이 있을 때).
- 목표 반영 권장 배분 도넛(`targetWeights`), 범례에 권장 금액(`layering: "applied"`일 때).
- `applied`이면 층 요약 가로 막대(비상금 / 가까운 목표 / 장기 투자, 금액). `needs_holdings`면 "자산을 입력하면 비상금과 목표 자금을 반영해요" 안내.
- "먼저 할 일" 카드: `directions` 앞 3개(제목, 본문, 금액, `href`로 가는 버튼).
- "추천 이유" 요약: `reasons` 앞 3개의 제목과 본문 첫 문장.
- 주 버튼 "왜 이렇게 추천했는지 자세히 보기" → `/allocation/recommendation/detail`. 보조 버튼: 자산이 있으면 "자산배분 리포트 보기", 없으면 "보유 자산 입력하기".
- 온보딩이면 위에 "설정을 마쳤어요. 이렇게 관리해 보세요." 안내와 "홈으로" 링크.
- `needs_profile`: "출생연도를 먼저 입력해 주세요"(`/onboarding`), `needs_assessment`: "투자성향 진단하기".
- 하단 `Disclaimer variant="investment"`.

### 9.6 `/allocation/recommendation/detail` (상세 설명)

1. 내 정보: 나이대(출생연도), 성향·점수, 상황(생활비·부양가족·대출), 목표 목록. 항목마다 "수정" 링크.
2. 권장 배분이 만들어진 순서: 층마다 금액과 자산군(비상금 → 가까운 목표 → 장기 투자), 장기 투자 몫을 표 비중으로 나눈 결과. `needs_holdings`면 순서만 설명한다.
3. 위험자산 비중 계산: 출발점(100 − 대표 나이), 성향 보정, 10~90% 제한 여부, 최종 값(`risky`).
4. 내 답변과 성향 점수: 문항마다 답 라벨과 막대(`points` / `maxPoints`), 합계는 `riskScore`. "문항별 점수는 반올림해서 합이 0.1점 다를 수 있어요" 각주.
5. 추천 이유 전체(`reasons`)와 자산군별 역할(`assetClassNotes`, 권장 비중과 함께).
6. 관리 방향 전체(`directions`).
7. "나이대·성향별 표 보기" 다이얼로그(7.5 표, 내 칸 강조).
8. 하단 `Disclaimer variant="investment"`.

## 10. 테스트

### 백엔드 (`backend/tests/allocation/`)

- 설문 점수: 5.1 검증 사례 5개, 등급 경계(20.0, 20.1, 40.0, 60.0, 80.0, 80.1)
- 배분표: 5.2 테스트 4종
- 점수: 5.4 검증 사례 3개, 등급 경계(89/90, 59/60)
- 리포트 상태 4종, 제외 자산 처리, 금액 0 자산 제외
- 리밸런싱 금액 계산
- 스냅샷: 같은 날 여러 번 변경해도 한 행, `scoreDelta` 계산(`freezegun`으로 날짜 이동)
- 상황·목표: CRUD, 검증 422, 11번째 목표 422, 제목 비우기 → 종류 이름, `horizon` 경계(오늘+1년 당일 `within_1y`, 오늘+3년 당일 `within_3y`, 그다음 날 `long_term`), 비상금 개월 수(부양가족, `income` 1·2, 진단 없음)
- 층 쌓기: 5.8 사례 4개와 자산 없음(`needs_holdings`), 현금성 자산이 나머지를 받아 합이 `T`와 같음, 같은 목표일의 목표 순서
- 관리 방향: 5.9 사례 5개의 kind·amount·assetClass 순서, body 문장 두 개를 글자 단위로 확인, 5%p 경계(4.99/5.00), 투자 권유 표현 없음
- 추천 이유: 5.10 code 순서와 조건, `risk_profile` 문장의 답 라벨·부호·제한 문장, `answerContributions` 두 사례(합 57.8, 73.2)
- 리포트가 목표 반영 권장으로 점수를 매긴다(5.8 사례 2 → 58점 D). 상황·목표 변경 후 스냅샷이 갱신된다
- 일괄 생성: 20개 모두 저장, 하나라도 실패하면 0건과 위치가 붙은 `field`, 스냅샷 1회
- `get_asset_breakdown`: 포함·제외 합계와 5개 키
- API: 설문·진단·타깃(409 두 종)·표·보유 CRUD·일괄 생성·상황·목표·추천(상태 3종)·리포트·이력, 검증 422, 다른 사용자 자원 404

### 프론트 (`frontend/tests/allocation/`, MSW)

- 설문 진행·이전·제출, `onboarding=1`이면 목표·상황으로, 아니면 추천 결과로 이동
- 온보딩 흐름: 목표·상황 저장·건너뛰기 → 간단 입력(0원 줄 제외 후 일괄 생성)·건너뛰기 → 추천 결과
- 목표·상황 화면: 목표 추가·수정·삭제, 10개면 추가 버튼 꺼짐, 비상금 목표 표시
- 추천 결과: `applied`·`needs_holdings`·`needs_profile`·`needs_assessment` 렌더링, 먼저 할 일 3개, 자세히 보기 이동
- 상세 설명: 층 순서, 답변 막대와 합계 각주, 방향 전체 목록
- 리포트 상태별 렌더링, 점수 카드·리밸런싱 표 문구, 추천 링크
- 보유 자산 추가·수정·삭제 후 목록·리포트·추천 갱신

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 가입 → 온보딩(출생연도) → 설문 → 목표·상황 → 자산 간단 입력 → 추천 결과 → 상세 설명 → 리포트 흐름이 실제 서버로 동작한다(건너뛰기 경로 포함)
- [ ] 5.1·5.2·5.4·5.8·5.9·5.10의 검증 사례가 테스트로 고정돼 있다
- [ ] 추천 결과·상세 설명·리포트·자산 화면에 `investment` 고지가 있다

## 12. 검증 체크리스트

1. `rules.py`의 25칸이 5.2 표와 글자 단위로 같고, 규칙 재계산 테스트가 있다.
2. 설문 문항·선택지 문구가 5.1과 같고, 가중치 합 7.5, 등급 경계가 표준 구간과 같다.
3. 점수 공식과 반올림(ROUND_HALF_UP), 등급 경계가 5.4와 같다.
4. 7절 응답 필드 이름·순서(`classes` 5개 고정 순서)·상태코드·에러 코드가 일치한다.
5. 스냅샷이 사용자·날짜당 한 행이고 `scoreDelta`가 앞선 날 기준이다.
6. 서비스 함수 시그니처가 8절과 같다.
7. 다른 사용자 보유 자산 조회·수정·삭제가 404다.
8. 360px에서 도넛·표·층 막대가 깨지지 않는다.
9. 5.8 층 계산 순서(비상금 → 가까운 목표 → 장기), 현금성 자산의 나머지 처리, `horizon` 경계, 사례 값이 같다.
10. 방향·이유 문구가 백엔드에서 만들어지고 5.9·5.10 문장 틀과 같다. 상품·종목 이름이나 투자 권유 표현이 없다.
11. 7.10이 스냅샷을 쓰지 않고, 상황·목표 변경이 리포트 점수와 스냅샷에 반영된다.
12. 온보딩 이동 경로와 건너뛰기가 9절 흐름과 같다.

## 13. 다음 단계 연결점

- 14: `holdings`에 동기화 컬럼을 추가하고 `upsert_synced_holdings`를 이 모듈 `service.py`에 더한다. `/allocation/assets`에 "증권사 잔고 불러오기"를 붙인다.
- 15: `get_allocation_report`·`get_recommendation`을 챗봇 도구로 감싼다("왜 이렇게 추천했어?").
- 16: 홈 대시보드에 점수 카드, 도넛, 첫 번째 관리 방향을 보여 준다. 체크리스트에 "목표·상황 입력하기"가 들어간다.
- 06: 상속세 추정과 방향 비교의 자산 사전 채움에 `get_asset_breakdown`을 쓴다.
