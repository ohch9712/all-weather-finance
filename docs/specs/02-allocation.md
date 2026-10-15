# 02. 자산배분: 투자성향 설문, 권장 배분, 보유 자산 입력, 배분 점수

> 웨이브 2 · 브랜치 `feature/02-allocation` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 01(develop 병합 완료). 공통 규칙 `AGENTS.md`, 이름 기준 `docs/architecture.md`.

## 1. 목표

- 증권사 방식의 투자성향 설문(6문항)으로 5등급 성향을 정한다.
- 나이대(01의 프로필)와 성향으로 25칸 권장 배분표에서 권장 비중을 고른다.
- 사용자가 보유 자산을 자산군별로 입력하면 실제 비중을 계산하고, 권장 배분과의 일치 점수(0~100)·등급·리밸런싱 금액·점수 이력을 보여 준다.
- 점수와 등급, 지난번 대비 변화로 흥미를 끈다.

## 2. 범위

### 포함

- 설문 문항 제공 API, 진단 저장·최신 조회
- 권장 배분 계산과 25칸 표 API
- 보유 자산 CRUD(평가금액 기준)
- 배분 리포트(상태별), 점수 일별 스냅샷과 이력
- 화면: `/allocation/survey`, `/allocation`, `/allocation/assets`
- 다른 모듈용 서비스 함수(8절)

### 제외

| 항목 | 처리 |
| --- | --- |
| 증권사 잔고 자동 반영 | 14 |
| 수량·단가 기반 평가(시세 연동) | 범위 밖. 평가금액을 직접 입력한다 |
| 목표 배분 사용자 맞춤 수정 | 범위 밖 |
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

- 점수 = `100 − Σ|실제 비중 − 권장 비중| ÷ 2`(5개 자산군, 퍼센트포인트), 정수로 반올림(ROUND_HALF_UP). 범위 0~100.
- 등급: 90 이상 S, 80 이상 A, 70 이상 B, 60 이상 C, 60 미만 D.
- 등급 메시지(화면용, 프론트 상수): S "권장 배분과 거의 같아요. 지금처럼 유지하세요.", A "아주 좋아요. 조금만 다듬으면 완벽해요.", B "조금만 조정하면 좋아요.", C "리밸런싱을 한 번 해 보면 좋겠어요.", D "권장 배분과 많이 달라요. 아래 안내를 참고하세요."

검증용 사례(권장 = 30대 위험중립형 65/25/5/5/0)

| 실제 비중(주식/채권/금/현금/기타) | 차이 합 | 점수 | 등급 |
| --- | --- | --- | --- |
| 65 / 25 / 5 / 5 / 0 | 0 | 100 | S |
| 50 / 30 / 0 / 20 / 0 | 40 | 80 | A |
| 0 / 0 / 0 / 100 / 0 | 190 | 5 | D |

### 5.5 리밸런싱 금액

- 자산군별 목표 금액 = `totalAmount × 권장 비중 ÷ 100`(원 단위 반올림), 차이 금액 = 목표 금액 − 현재 금액. 양수는 "더 모으기", 음수는 "줄이기"로 표시한다.
- 매매를 권하는 문구가 아니라 비중 차이 안내라는 점을 화면에 적는다(`investment` 고지).

### 5.6 점수 스냅샷

- 리포트 상태가 `ready`로 계산될 때마다(`GET /report`, 보유 자산 생성·수정·삭제, 진단 저장 직후) 오늘(KST) 행을 upsert한다.
- `scoreDelta` = 오늘 점수 − 오늘보다 앞선 가장 최근 스냅샷 점수. 없으면 `null`.

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
| `actual_weights`, `target_weights` | `jsonb` | NOT NULL |
| `age_band` | `varchar(4)` | NOT NULL |
| `risk_profile` | `varchar(16)` | NOT NULL |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

UNIQUE `(user_id, scored_on)`.

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

### 7.7 `GET /api/allocation/report`

```json
{
  "status": "ready",
  "ageBand": "30s",
  "riskProfile": "neutral",
  "totalAmount": 52000000,
  "excludedAmount": 300000000,
  "score": 80,
  "grade": "A",
  "scoreDelta": 3,
  "scoredOn": "2026-10-16",
  "classes": [
    { "assetClass": "stock", "actualAmount": 26000000, "actualWeight": 50.0, "targetWeight": 65, "targetAmount": 33800000, "diffAmount": 7800000 }
  ]
}
```

- `status` 판정 순서: 출생연도 없음 `needs_profile` → 진단 없음 `needs_assessment` → 배분 대상 자산 합계 0 `needs_holdings` → `ready`.
- `classes`는 항상 5개, 순서는 `stock, bond, gold, cash, other`. `ready`가 아니면 `score`, `grade`, `scoreDelta`, `scoredOn`, `classes`는 `null`이고, 알 수 있는 `ageBand`·`riskProfile`·`totalAmount`·`excludedAmount`만 채운다.

### 7.8 `GET /api/allocation/scores?days=180`

- `days` 1~730(기본 180). `200 {"items": [{"scoredOn": "2026-10-01", "score": 72, "grade": "B"}]}` 날짜 오름차순.

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

def get_latest_risk_profile(db, user_id) -> RiskProfileInfo | None
def get_target_allocation(db, user_id) -> TargetAllocation        # AppError 409 PROFILE_INCOMPLETE / RISK_PROFILE_REQUIRED
def get_allocation_report(db, user_id) -> AllocationReport        # 7.7과 같은 내용의 Pydantic 모델
def get_investable_total(db, user_id) -> int
```

- 15(챗봇 도구)와 16(대시보드)이 `get_allocation_report`를, 06(상속세 추정)이 `get_investable_total`을 쓴다.
- `get_allocation_report`는 부수 효과로 스냅샷을 upsert한다. 호출한 쪽이 트랜잭션을 커밋한다(라우터는 커밋한다).

## 9. 화면 명세

### 9.1 `/allocation/survey`

- 한 화면에 한 문항, 진행률 표시(1/6), 이전·다음 버튼. 마지막에 "결과 보기".
- 결과: 성향 이름(`RISK_PROFILE_LABEL`), 점수, 한 줄 설명(프론트 상수), 내 나이대의 권장 배분 도넛(`GET /target`).
- `?onboarding=1`이면 결과 화면의 주 버튼이 "보유 자산 입력하기"(`/allocation/assets`), 아니면 "자산배분 리포트 보기"(`/allocation`).
- 성향 한 줄 설명: 안정형 "원금 보전이 가장 중요해요.", 안정추구형 "손실은 작게, 이자보다 조금 높은 수익을 원해요.", 위험중립형 "수익과 위험의 균형을 원해요.", 적극투자형 "높은 수익을 위해 손실도 어느 정도 감수해요.", 공격투자형 "큰 수익을 위해 큰 손실도 감수할 수 있어요."

### 9.2 `/allocation`

- 상태별 화면
  - `needs_assessment`: 안내와 "투자성향 진단하기" 버튼
  - `needs_holdings`: 내 권장 배분 도넛 + "보유 자산 입력하기" 버튼
  - `ready`: 아래 전부
- 점수 카드: 큰 점수, 등급 배지, 등급 메시지, `scoreDelta`(▲3 / ▼2, 없으면 숨김).
- 도넛 두 개(권장 / 내 자산), 자산군 색은 `--asset-*`.
- 자산군별 차이 막대(실제 − 권장, 0 기준 좌우), 리밸런싱 표(자산군, 현재 금액, 목표 금액, 차이 "+780만원 더 모으기"/"-120만원 줄이기").
- 점수 이력 선 그래프(`GET /scores`), 데이터 2개 미만이면 숨김.
- 규칙 설명(`explanation`)과 "나이대·성향별 표 보기" 다이얼로그(7.5 표, 내 칸 강조).
- 하단 `Disclaimer variant="investment"`. 제외 자산이 있으면 "점수 계산에서 뺀 자산 3억원" 안내.

### 9.3 `/allocation/assets`

- 자산군별로 묶은 목록(자산군 합계와 비중), 항목: 이름, 금액(`MoneyText`), 제외 여부 배지, 출처 배지(`manual` 외에는 "증권사 연동").
- 추가·수정 다이얼로그: 이름, 자산군 선택, 금액(숫자 입력 + "만원" 단위 도우미 표시), 점수 계산 포함 스위치, 메모.
- 빠른 추가 버튼: 예금·적금(cash), 비상금(cash), 국내주식(stock), 해외주식(stock), 채권 ETF(bond), 금 ETF(gold), 리츠(other), 실거주 주택(other, 제외로 기본 설정).
- 삭제 확인(`ConfirmDialog`). 변경 후 리포트·점수 쿼리를 무효화한다.

## 10. 테스트

### 백엔드 (`backend/tests/allocation/`)

- 설문 점수: 5.1 검증 사례 5개, 등급 경계(20.0, 20.1, 40.0, 60.0, 80.0, 80.1)
- 배분표: 5.2 테스트 4종
- 점수: 5.4 검증 사례 3개, 등급 경계(89/90, 59/60)
- 리포트 상태 4종, 제외 자산 처리, 금액 0 자산 제외
- 리밸런싱 금액 계산
- 스냅샷: 같은 날 여러 번 변경해도 한 행, `scoreDelta` 계산(`freezegun`으로 날짜 이동)
- API: 설문·진단·타깃(409 두 종)·표·보유 CRUD·리포트·이력, 검증 422, 다른 사용자 자원 404

### 프론트 (`frontend/tests/allocation/`, MSW)

- 설문 진행·이전·제출·결과, `onboarding=1` 분기
- 리포트 상태별 렌더링, 점수 카드·리밸런싱 표 문구
- 보유 자산 추가·수정·삭제 후 목록·리포트 갱신

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 가입 → 온보딩 → 설문 → 자산 입력 → 리포트 흐름이 실제 서버로 동작한다
- [ ] 5.1·5.2·5.4의 검증 사례가 테스트로 고정돼 있다
- [ ] 리포트·자산 화면에 `investment` 고지가 있다

## 12. 검증 체크리스트

1. `rules.py`의 25칸이 5.2 표와 글자 단위로 같고, 규칙 재계산 테스트가 있다.
2. 설문 문항·선택지 문구가 5.1과 같고, 가중치 합 7.5, 등급 경계가 표준 구간과 같다.
3. 점수 공식과 반올림(ROUND_HALF_UP), 등급 경계가 5.4와 같다.
4. 7절 응답 필드 이름·순서(`classes` 5개 고정 순서)·상태코드·에러 코드가 일치한다.
5. 스냅샷이 사용자·날짜당 한 행이고 `scoreDelta`가 앞선 날 기준이다.
6. 서비스 함수 시그니처가 8절과 같다.
7. 다른 사용자 보유 자산 조회·수정·삭제가 404다.
8. 360px에서 도넛·표가 깨지지 않는다.

## 13. 다음 단계 연결점

- 14: `holdings`에 동기화 컬럼을 추가하고 `upsert_synced_holdings`를 이 모듈 `service.py`에 더한다. `/allocation/assets`에 "증권사 잔고 불러오기"를 붙인다.
- 15: `get_allocation_report`를 챗봇 도구로 감싼다.
- 16: 홈 대시보드에 점수 카드와 도넛을 보여 준다.
- 06: 상속세 추정의 기본 재산 값으로 `get_investable_total`을 쓴다.
