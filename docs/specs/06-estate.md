# 06. 상속·증여 플래너: 가족·증여 기록, 공제 현황, 증여세·상속세 계산, 분산 증여 시뮬레이터, 방향 비교

> 웨이브 2 · 브랜치 `feature/06-estate` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 01. 02의 `get_asset_breakdown`은 상속세 추정·방향 비교의 사전 채움에만 쓴다(02와 병렬이므로 9.3절의 처리 방식을 따른다).

## 1. 목표

- 자녀·배우자 등 가족과 지금까지의 증여 기록을 관리하고, 사람마다 10년 합산 증여재산공제를 얼마나 썼고 언제 다시 생기는지 보여 준다.
- 증여세와 상속세를 단계별 설명과 함께 계산한다.
- 자녀 생년월일 기준으로 공제를 최대한 쓰는 10년 주기 분산 증여 일정을 제안하고, 한 번에 증여할 때와 세금·미래가치를 비교한다.
- 가족 구성과 자산 정보를 써서 상속·증여 **방향**(증여 없이 상속, 자녀 분산 증여, 지금 일시 증여, 손자녀 분산 증여)을 같은 가정으로 계산해 총 세금과 가족에게 남는 금액을 나란히 보여 준다(8.1). 결과는 참고용이다.
- 모든 세법 수치는 시행일이 붙은 규칙 파일 하나에 모은다. 법이 바뀌면 새 규칙 파일을 추가한다.

## 2. 범위

### 포함

- 가족 CRUD, 증여 기록 CRUD
- 공제 현황 계산(기록 재생 방식)
- 증여세 계산기, 상속세 추정기, 분산 증여 시뮬레이터, 방향 비교, 규칙 조회 API
- 화면 `/estate`
- 서비스 함수(8절)

### 제외 (계산을 단순화한 부분은 화면 "계산 가정"에 그대로 보여 준다)

- 비거주자, 부담부증여, 창업자금·가업승계·영농 특례, 증여재산 평가 규칙(사용자가 입력한 평가액을 그대로 쓴다)
- 상속인은 배우자와 자녀만 다룬다(대습상속, 직계존속·형제 상속 제외)
- 배우자 상속공제의 법정 한도는 9.2절의 단순식으로 계산한다
- 상속세 세대생략 할증, 재해손실공제, 가업·영농상속공제
- 방향 비교의 배우자 증여 방향, 부동산 증여·평가, 2차 상속(배우자 사망 뒤 다시 상속)
- 실제 신고서 작성

## 3. 소유 파일

- `backend/app/modules/estate/**`(규칙 파일 `estate/rules/**` 포함)
- `backend/alembic/versions/estate_0001_*.py`
- `backend/tests/estate/**`
- `frontend/src/app/(app)/estate/**`(자리표시 교체)
- `frontend/src/features/estate/**`
- `frontend/tests/estate/**`
- 이 문서의 `## 구현 결과`

## 4. 규칙 파일 (`estate/rules/kr_2024_01_01.py`)

```python
RULES_2024_01_01 = RuleSet(
    version="KR-2024.01.01",
    effective_from=date(2024, 1, 1),   # 혼인·출산 증여재산공제 시행일
    sources=[("상속세 및 증여세법", "https://www.law.go.kr/법령/상속세및증여세법")],
    ...
)
def get_active_rules(on: date) -> RuleSet   # effective_from <= on 인 것 중 최신
```

| 항목 | 값 | 근거(상속세 및 증여세법) |
| --- | --- | --- |
| 세율 구간 | 1억 이하 10% / 5억 이하 20%(누진공제 1천만) / 10억 이하 30%(6천만) / 30억 이하 40%(1억6천만) / 30억 초과 50%(4억6천만) | 제26조, 제56조 |
| 과세 최저한 | 과세표준 50만 원 미만이면 세액 0 | 제25조②, 제55조② |
| 신고세액공제 | 3% | 제69조 |
| 증여재산공제(10년 합산 한도) | 배우자 6억, 직계존속→성년 5천만·미성년 2천만, 직계비속 5천만, 기타친족(4촌 이내 혈족·3촌 이내 인척) 1천만. 2025-03-14 전 증여는 종전 범위(6촌 이내 혈족·4촌 이내 인척)를 따른다(법률 제20777호 부칙 제4조) | 제53조 |
| 혼인·출산 증여재산공제 | 직계존속으로부터, 혼인신고일 전후 2년 또는 자녀 출생일(입양신고일)부터 2년 이내 증여, 혼인·출산 합산 평생 1억 | 제53조의2 |
| 증여 합산 | 증여일 전 10년 이내 동일인(직계존속이면 그 배우자 포함) 증여 합계가 1천만 원 이상이면 합산 | 제47조② |
| 세대생략 할증 | 30%, 수증자가 미성년자이고 증여재산가액이 20억 초과면 40%. 수증자의 부모가 사망한 경우 제외 | 제57조 |
| 미성년자 | 증여일 기준 만 19세 미만 | 민법 제4조 |
| 상속 기초공제 | 2억 | 제18조 |
| 상속 인적공제 | 자녀 1인당 5천만, 미성년자 1천만 × (19 − 나이), 65세 이상 5천만, 장애인 1천만 × 기대여명 연수 | 제20조 |
| 일괄공제 | 5억(배우자 단독상속이면 적용 불가) | 제21조 |
| 배우자 상속공제 | 실제 상속액(법정상속분·30억 한도), 최소 5억 | 제19조 |
| 금융재산 상속공제 | 순금융재산 2천만 이하 전액, 1억 이하 2천만, 1억 초과 20%(최대 2억) | 제22조 |
| 동거주택 상속공제 | 주택가액 100%, 최대 6억 | 제23조의2 |
| 장례비 | 최소 500만·최대 1천만 + 봉안시설 최대 500만 | 시행령 제9조 |
| 사전증여 가산 | 상속인 10년, 상속인 외 5년 | 제13조 |
| 상속공제 종합한도 | 과세가액 − (사전증여 가산액 − 그 증여의 증여재산공제액) | 제24조(단순화) |

- 구현 워커는 위 값을 국가법령정보센터 원문으로 다시 확인하고, 다르면 코드를 바꾸지 말고 코디네이터에게 묻는다.
- 계산 규칙: 모든 금액은 `Decimal`로 계산하고 단계마다 원 단위로 버린다(ROUND_DOWN).

## 5. 증여세 계산 (`calc_gift_tax`)

용어

- 증여자 그룹 `donorGroup`: `parents`(부모, 둘을 동일인으로 봄), `grandparents`(조부모), `spouse`, `children`(자녀가 부모에게), `relative`(기타친족), `non_relative`
- 공제 구분 `deductionCategory`(그룹에서 결정): `parents`·`grandparents` → `lineal_ascendant`, `spouse` → `spouse`, `children` → `lineal_descendant`, `relative` → `other_relative`, `non_relative` → `none`

순서

1. 합산액 = 이번 증여일 전 10년 이내(증여일 − 10년 < 날짜 < 증여일) **같은 그룹**의 기록 합계. 1천만 원 미만이면 0.
2. 과세가액 = 이번 증여액 + 합산액.
3. 증여재산공제 = `min(공제 한도(증여일 기준 수증자 나이) − 다른 그룹이 같은 공제 구분에서 10년 내 쓴 공제액, 과세가액)`, 0 미만이면 0.
4. 혼인·출산 공제(직계존속 그룹이고 증여일이 기간 안이며 신청한 경우) = `min(1억 − 이미 쓴 혼인·출산 공제, 과세가액 − 증여재산공제)`.
5. 과세표준 = 과세가액 − 증여재산공제 − 혼인·출산 공제 − 감정평가수수료. 50만 원 미만이면 이후 세액 0.
6. 산출세액 = 누진세율.
7. 할증 = `grandparents` 그룹이고 할증 제외가 아니면 산출세액 × 30%(미성년이고 이번 증여액 20억 초과면 40%).
8. 기납부세액공제 = `min(합산된 기록들의 납부세액 합, 산출세액 + 할증)`.
9. 신고세액공제 = (산출세액 + 할증 − 기납부세액공제) × 3%.
10. 납부세액 = 산출세액 + 할증 − 기납부세액공제 − 신고세액공제(0 미만이면 0).

검증용 사례(신고기한 내 신고 가정)

| 사례 | 과세표준 | 산출세액 | 할증 | 신고공제 | 납부세액 |
| --- | --- | --- | --- | --- | --- |
| 성년 자녀, 부모 5천만 | 0 | 0 | 0 | 0 | 0 |
| 성년 자녀, 부모 1억 | 50,000,000 | 5,000,000 | 0 | 150,000 | 4,850,000 |
| 성년 자녀, 부모 3억 | 250,000,000 | 40,000,000 | 0 | 1,200,000 | 38,800,000 |
| 미성년 자녀, 부모 3천만 | 10,000,000 | 1,000,000 | 0 | 30,000 | 970,000 |
| 성년 손자녀, 조부모 1억 | 50,000,000 | 5,000,000 | 1,500,000 | 195,000 | 6,305,000 |
| 배우자 7억 | 100,000,000 | 10,000,000 | 0 | 300,000 | 9,700,000 |
| 성년 자녀, 부모 2년 전 3천만 + 이번 5천만 | 30,000,000 | 3,000,000 | 0 | 90,000 | 2,910,000 |
| 성년 자녀, 혼인신고 5개월 뒤 부모 1.5억(혼인공제 신청) | 0 | 0 | 0 | 0 | 0 |
| 성년 자녀, 부모 5,040만 | 400,000(최저한) | 0 | 0 | 0 | 0 |
| 성년 자녀, 조부모가 10년 내 공제 2천만 사용 + 이번 부모 1억 | 70,000,000 | 7,000,000 | 0 | 210,000 | 6,790,000 |

## 6. 공제 현황 (`get_deduction_status`)

- 수증자의 모든 기록을 날짜순으로 재생하며 기록마다 적용된 증여재산공제를 계산한다: `기록 공제 = min(그 날짜의 한도 − 그 날짜 기준 10년 내 같은 공제 구분 기록들의 공제 합, 기록 금액)`. 혼인·출산 공제도 같은 방식(평생 한도)으로 재생한다.
- 기준일 `asOf`의 구분별 결과: 한도, 10년 내 사용액(`asOf − 10년 < 날짜 <= asOf`), 남은 공제, 다음에 공제가 다시 생기는 날(창 안 기록 중 가장 이른 날짜 + 10년 + 1일), 미성년이면 성년이 되는 날.

검증용 사례: 2010-03-01생 자녀, 기록 ① 2016-05-01 부모 2천만, ② 2024-02-01 조부모 1천만

- ①의 공제 2천만(미성년 한도 전부), ②의 공제 0(창 안에 ①이 있어 남은 한도 0). ②의 추정 납부세액은 1,261,000(과세표준 1천만, 산출 100만, 할증 30만, 신고공제 3.9만).
- 2026-10-16 기준: 나이 16(미성년), 직계존속 한도 2천만, 10년 내 사용 0(①은 창 밖, ②의 공제는 0), 남은 공제 2천만, 성년이 되는 날 2029-03-01.

## 7. 상속세 추정 (`calc_inheritance_tax`)

1. 장례비 공제 = `clamp(장례비, 500만, 1천만) + min(봉안비, 500만)`.
2. 과세가액 = 총상속재산(금융 + 부동산 + 기타) − 채무 − 장례비 공제 + 상속인 사전증여(10년) + 상속인 외 사전증여(5년), 0 미만이면 0.
3. 기타 인적공제 = `max(2억 + 인적공제, 5억)`. 배우자 단독상속(배우자 있음, 자녀 0)이면 `2억 + 인적공제`.
4. 배우자공제(배우자 있음): 법정 비율 = 1.5 ÷ (1.5 + 자녀 수)(자녀 0이면 1). 법정 한도 = (총상속재산 − 채무 + 상속인 사전증여) × 법정 비율. 배우자공제 = `max(5억, min(배우자 실제 상속액(기본값은 법정 한도), 법정 한도, 30억))`.
5. 금융재산공제 = 순금융재산(금융 − 금융채무) 기준 4절 규칙.
6. 동거주택공제 = 요건 충족 체크 시 `min(주택가액, 6억)`.
7. 공제 합계 = 3 + 4 + 5 + 6. 종합한도 = 과세가액 − (사전증여 가산액 − 그 증여들의 증여재산공제액). 적용 공제 = `min(공제 합계, 종합한도)`.
8. 과세표준 = 과세가액 − 적용 공제 − 감정평가수수료. 50만 원 미만이면 세액 0.
9. 산출세액 → 증여세액공제 = `min(사전증여 납부세액 합, 산출세액)` → 신고세액공제 3% → 납부세액.

검증용 사례(사전증여 없음)

| 사례 | 과세가액 | 적용 공제 | 과세표준 | 산출세액 | 납부세액 |
| --- | --- | --- | --- | --- | --- |
| 배우자 + 성년 자녀 2, 총 10억(금융 3억), 장례비 1천만 | 990,000,000 | 990,000,000 | 0 | 0 | 0 |
| 배우자 + 성년 자녀 2, 총 30억(금융 5억), 장례비 1천만 | 2,990,000,000 | 1,885,714,285 | 1,104,285,715 | 281,714,286 | 273,262,858 |
| 배우자 없음 + 성년 자녀 1, 총 8억(금융 1억), 장례비 300만 | 795,000,000 | 520,000,000 | 275,000,000 | 45,000,000 | 43,650,000 |
| 배우자 단독, 총 7억(금융 0) | 695,000,000 | 695,000,000 | 0 | 0 | 0 |
| 배우자 없음 + 10세 자녀 1, 총 15억(금융 2억) | 1,495,000,000 | 540,000,000 | 955,000,000 | 226,500,000 | 219,705,000 |

- 30억 사례의 배우자공제는 1,285,714,285(= 30억 × 1.5 ÷ 3.5, 원 미만 버림), 금융재산공제 1억, 일괄공제 5억이다.

## 8. 분산 증여 시뮬레이터 (`simulate_gift_plan`)

- 입력: 수증자(가족 id 또는 생년월일), 시작일(기본 오늘 KST), 목표 나이(19~40, 기본 30), 연 기대수익률(문자열 decimal %, 0~20, 기본 "4"), 증여자 그룹(기본 `parents`), 예상 혼인일(선택).
- 끝나는 날 = (목표 나이 + 1)번째 생일 전날.
- 10년 주기 일정
  1. 첫 후보일 = max(시작일, 생년월일).
  2. 후보일마다 금액 = 그날 나이의 직계존속 한도 − 그날 기준 10년 내 같은 공제 구분 사용액(기존 기록 포함). 0보다 크면 일정에 넣는다.
  3. 다음 후보일 = 마지막 일정일 + 10년 + 1일. 금액이 0이라 넣지 못했으면 창 안 기록 중 가장 이른 날짜 + 10년 + 1일.
  4. 후보일이 끝나는 날을 넘으면 멈춘다.
  - 성년이 되는 날의 추가 공제를 바로 쓰면 다음 주기 공제가 줄어들기 때문에 이 시뮬레이터는 10년 주기만 쓴다. 화면 "계산 가정"에 적는다.
- 예상 혼인일이 첫 후보일과 끝나는 날 사이면 그날 혼인 공제분(1억 − 이미 쓴 혼인·출산 공제)을 별도 항목으로 넣는다.
- 미래가치 = Σ 증여액 × (1 + 수익률)^(경과일 ÷ 365), 경과일은 증여일부터 끝나는 날까지, `Decimal`(정밀도 28)로 계산 후 원 단위 버림.
- 비교: 일정 합계 금액을 끝나는 날에 한 번에 증여할 때의 증여세(기록 없음 가정, `calc_gift_tax`).
- 안내 문구: 증여 후 오른 가치는 일반적으로 증여세 대상이 아니지만, 특수관계 거래·상장 차익 등 예외가 있다(제42조의3).

검증용 사례: 2026-01-01생, 시작 2026-10-16, 목표 30세, 수익률 5%, 기존 기록 없음

| 증여일 | 나이 | 금액 |
| --- | --- | --- |
| 2026-10-16 | 0 | 20,000,000 |
| 2036-10-17 | 10 | 20,000,000 |
| 2046-10-18 | 20 | 50,000,000 |
| 2056-10-19 | 30 | 50,000,000 |

- 끝나는 날 2056-12-31, 합계 140,000,000, 세금 0, 미래가치 273,828,999(±100원 허용). 한 번에 증여하면 과세표준 90,000,000, 납부세액 8,730,000.

### 8.1 상속·증여 방향 비교 (`compare_estate_plans`)

같은 가족·자산·가정으로 아래 방향을 계산해 나란히 보여 준다. 화면과 응답의 순서는 이 표의 순서이고, 포함 조건에 맞는 방향만 넣는다.

| key | label | 증여 | 포함 조건 |
| --- | --- | --- | --- |
| `inherit_only` | 증여 없이 상속 | 없음 | 항상 |
| `staged_children` | 자녀에게 10년마다 공제 한도만큼 증여 | 회차일마다 자녀에게 직계존속 공제 남은 금액(`parents` 그룹) | 생년월일 있는 자녀 1명 이상 |
| `lump_sum_now` | 자녀에게 지금 {일시 증여 금액}씩 증여 | 기준일에 자녀마다 일시 증여 금액(`parents` 그룹) | 생년월일 있는 자녀 1명 이상 |
| `staged_grandchildren` | 손자녀에게 10년마다 공제 한도만큼 증여 | 회차일마다 손자녀에게 직계존속 공제 남은 금액(`grandparents` 그룹) | 생년월일 있는 손자녀 1명 이상 |

입력

- 기준일 `D0`(기본 오늘 KST), 상속 가정 시점 `n`년 뒤(1~40, 기본 20). `T = D0 + n년`(같은 월·일, 2월 29일은 2월 28일).
- 재산 연 증가율 `g`(문자열 decimal %, 0~10, 기본 `"3"`), 현재 재산(금융·부동산·기타, 채무), 배우자 생존 여부, 자녀·손자녀(가족 등록, `relation`이 `child`·`grandchild`), 기존 증여 기록, 일시 증여 금액(기본 100,000,000, 1원~1조 원).

계산 순서

1. 성장 계수 `F(a) = (1 + g ÷ 100)^((T − a)의 일수 ÷ 365)`(`Decimal` 정밀도 28). 금액 `x`의 T 시점 가치 `V(x, a) = x × F(a)`를 원 단위로 버린다.
2. 증여 일정(방향마다 따로 만든다)
   - 회차일은 `D0`, 그다음은 직전 회차일 + 10년 + 1일이다. T를 넘으면 멈춘다.
   - 분산 방향: 회차일마다 대상자를 생년월일 순(같으면 별칭 순)으로 보며 금액 = `min(그날 나이의 직계존속 공제 한도 − 그날 기준 10년 안(그날 − 10년 < 날짜 ≤ 그날)에 그 수증자가 직계존속 공제 구분으로 쓴 공제(기존 기록 + 이 방향의 앞선 증여), 남은 예산)`. 0 이하면 넣지 않는다. 그날 아직 태어나지 않은 대상자는 넘긴다.
   - 일시 방향: `D0`에 자녀 순서대로 `min(일시 증여 금액, 남은 예산)`.
   - 예산: 한 방향의 증여 명목 합계는 현재 금융재산을 넘지 않는다(증여는 금융재산에서 현금으로 한다고 가정).
   - 증여세: 증여마다 `calc_gift_tax`(5절)로 계산한다. 이전 증여는 그 수증자의 기존 기록과 이 방향의 앞선 증여다. 혼인·출산 공제는 신청하지 않는다.
3. T 시점 재산: 금융 = `max(0, V(현재 금융, D0) − Σ V(증여액, 증여일))`, 부동산 = `V(현재 부동산, D0)`, 기타 = `V(현재 기타, D0)`, 채무는 그대로. 상속재산 = `max(0, 금융 + 부동산 + 기타 − 채무)`.
4. 상속세: `calc_inheritance_tax`(7절)를 부른다. 자녀 나이는 T 기준이다. 장례비·봉안비 0(최소 장례비 공제 500만 원 적용), 동거주택공제 없음, 감정평가수수료 0, 배우자 실제 상속액 없음(법정 한도), 금융채무 0으로 둔다.
   - 사전증여 가산: 상속인(자녀·배우자가 받은 `parents`·`spouse` 그룹 증여)은 `T − 10년 < 날짜 ≤ T`, 상속인 외(손자녀가 받은 `grandparents` 그룹 증여)는 `T − 5년 < 날짜 ≤ T`인 증여(기존 기록 + 이 방향의 증여)의 증여 당시 금액 합이다. `priorGiftDeductions`는 그 증여들에 적용된 증여재산공제 합, `priorGiftTaxPaid`는 그 증여들의 증여세 합(기존 기록은 `tax_paid`)이다.
5. 결과: 증여 합계, 증여세 합계, T 시점 증여 자산 가치(`Σ V(증여액, 증여일)`), T 시점 증여세 가치(`giftTaxAtHorizon` = `Σ V(증여세, 증여일)`, 증여마다 버림, 17절), T 시점 상속재산, 상속세, 총 세금(증여세 합계 + 상속세, 낸 금액 그대로), 상속 시점 기준 총 세금(`totalTaxAtHorizon` = T 시점 증여세 가치 + 상속세), 가족에게 남는 금액(`상속재산 − 상속세 + T 시점 증여 자산 가치 − T 시점 증여세 가치`).
6. `recommendedKey`: 가족에게 남는 금액이 가장 큰 방향. 같으면 상속 시점 기준 총 세금이 적은 방향, 그래도 같으면 표 순서가 앞선 방향.

- 배우자도 자녀도 없으면 `422`(`field: "children"`, "자녀나 배우자를 먼저 가족에 등록해 주세요."). 생년월일이 없는 자녀·손자녀는 계산에서 빼고 `notes`에 "생년월일이 없는 가족 {N}명은 계산에서 뺐어요."를 넣는다.
- `notes`(항상): "상속 전 10년(상속인이 아닌 손자녀는 5년) 안에 한 증여는 상속재산에 다시 더해져요.", "재산과 증여한 돈이 모두 연 {g}%씩 늘어난다고 가정했어요.", "증여할 때 낸 증여세도 상속 시점까지 연 {g}%로 불려 총 세금과 가족에게 남는 금액에 반영했어요.", "실제 상속 시점과 재산 가치, 세법은 달라질 수 있어요."
- `assumptions`: 증여는 금융재산에서 현금으로 한다, 부동산 증여·평가와 배우자 증여·2차 상속은 다루지 않는다, 장례비는 최소 공제만 반영한다, 혼인·출산 공제는 신청하지 않는다, 증여세는 받은 사람이 증여할 때 낸다.
- `recommendedKey`는 "같은 가정에서 가족에게 가장 많이 남는 방향"이라는 뜻으로만 보여 준다. 세무 판단을 대신하지 않는다.

검증용 사례(기존 기록 없음, 성장률이 0이 아닌 사례는 금액마다 ±1,000원 허용)

사례 1: 기준일 2026-10-16, 20년 뒤(T = 2046-10-16), 연 3%. 금융 600,000,000, 부동산 900,000,000, 기타 0, 채무 0. 배우자 있음, 자녀 첫째 1991-03-01·둘째 1994-07-15(T에 55·52세), 손자녀 손주 2020-05-05. 일시 증여 1억 원씩.

| 방향 | 증여(날짜, 금액, 증여세) | 증여세 합계 | T 상속재산 | 상속세 | 총 세금 | 증여 자산 T 가치 | 증여세 T 가치 | 상속 시점 기준 총 세금 | 가족에게 남는 금액 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `inherit_only` | 없음 | 0 | 2,710,264,056 | 187,323,195 | 187,323,195 | 0 | 0 | 187,323,195 | 2,522,940,861 |
| `staged_children` | 2026-10-16 첫째·둘째 각 50,000,000 / 2036-10-17 첫째·둘째 각 50,000,000, 모두 세금 0 | 0 | 2,395,177,266 | 165,000,438 | 165,000,438 | 315,086,790 | 0 | 165,000,438 | 2,545,263,618 |
| `lump_sum_now` | 2026-10-16 첫째·둘째 각 100,000,000, 각 4,850,000 | 9,700,000 | 2,348,895,516 | 143,369,471 | 153,069,471 | 361,368,540 | 17,526,374 | 160,895,845 | 2,549,368,211 |
| `staged_grandchildren` | 2026-10-16 손주 20,000,000 / 2036-10-17 손주 20,000,000(두 번 모두 미성년), 세금 0 | 0 | 2,647,246,698 | 176,844,308 | 176,844,308 | 63,017,358 | 0 | 176,844,308 | 2,533,419,748 |

- `recommendedKey` = `lump_sum_now`. `lump_sum_now`의 가족에게 남는 금액은 17절 전 2,557,194,585였다(증여세를 낸 금액 그대로 뺐다).
- `inherit_only`의 T 시점 금융·부동산은 1,084,105,622 · 1,626,158,434이다. 상속세 단계: 과세가액 2,705,264,056, 일괄공제 500,000,000, 배우자공제 1,161,541,738, 금융재산공제 200,000,000, 과세표준 843,722,318, 산출세액 193,116,695, 신고세액공제 5,793,500.
- `staged_children`의 2036-10-17 증여 100,000,000은 T − 10년(2036-10-16) 뒤라 상속재산에 다시 더해진다(과세가액 2,490,177,266). 손주가 받은 증여는 T − 5년(2041-10-16) 전이라 더하지 않는다.

사례 2(10년 합산 효과): 기준일 2026-10-16, 5년 뒤(T = 2031-10-16), 연 0%. 금융 300,000,000, 부동산 500,000,000, 기타 0, 채무 0. 배우자 없음, 자녀 1994-07-15 1명. 일시 증여 1억 원.

| 방향 | 증여세 합계 | T 상속재산 | 상속세 | 총 세금 | 가족에게 남는 금액 |
| --- | --- | --- | --- | --- | --- |
| `inherit_only` | 0 | 800,000,000 | 35,890,000 | 35,890,000 | 764,110,000 |
| `staged_children`(2026-10-16 50,000,000) | 0 | 750,000,000 | 37,830,000 | 37,830,000 | 762,170,000 |
| `lump_sum_now`(2026-10-16 100,000,000) | 4,850,000 | 700,000,000 | 35,065,500 | 39,915,500 | 760,084,500 |

- `recommendedKey` = `inherit_only`. 5년 안의 증여는 모두 다시 더해지고, 증여한 만큼 금융재산공제가 줄어(60,000,000 → 50,000,000 → 40,000,000) 분산 증여의 상속세가 오히려 늘어난다. `lump_sum_now`는 종합한도가 745,000,000으로 줄고 증여세액공제 4,850,000을 받는다.

- 사례 2는 증가율 0%라 모든 방향에서 `giftTaxAtHorizon` = `giftTaxTotal`, `totalTaxAtHorizon` = `totalTax`이고 값은 그대로다.

사례 3(증여세를 낸 시점의 효과, 17절): 사례 1과 같고 40년 뒤(T = 2066-10-16), 일시 증여 500,000,000. `lump_sum_now`는 2026-10-16 첫째 500,000,000(증여세 77,600,000), 둘째 100,000,000(예산 한도, 4,850,000).

| 방향 | 증여세 합계 | 증여세 T 가치 | 상속세 | 총 세금 | 상속 시점 기준 총 세금 | 가족에게 남는 금액 |
| --- | --- | --- | --- | --- | --- | --- |
| `inherit_only` | 0 | 0 | 656,999,477 | 656,999,477 | 656,999,477 | 4,240,021,360 |
| `staged_children` | 0 | 0 | 483,098,314 | 483,098,314 | 483,098,314 | 4,413,922,523 |
| `lump_sum_now` | 82,450,000 | 269,172,911 | 300,303,687 | 382,753,687 | 569,476,598 | 4,327,544,239 |
| `staged_grandchildren` | 0 | 0 | 596,830,580 | 596,830,580 | 596,830,580 | 4,300,190,257 |

- `recommendedKey` = `staged_children`. 17절 전에는 `lump_sum_now`(가족에게 남는 금액 4,514,267,150)였다.

## 9. DB 스키마 (revision `estate_0001`, `branch_labels=("estate",)`)

### 9.1 `family_members`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `relation` | `varchar(16)` | NOT NULL, CHECK `spouse, child, grandchild, parent, other_relative` |
| `display_name` | `varchar(20)` | NOT NULL. 실명 대신 별칭 권장 |
| `birth_date` | `date` | NULL(배우자·부모는 선택, 자녀·손자녀는 필수) |
| `married_on` | `date` | NULL. 수증자 본인의 혼인신고일 |
| `child_birth_dates` | `date[]` | NOT NULL, default `{}`, 최대 10개. 수증자 자녀의 출생·입양일 |
| `parent_deceased` | `boolean` | NOT NULL, default false. 손자녀의 부모 사망(할증 제외) |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

### 9.2 `gift_records`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `recipient_id` | `uuid` | NOT NULL, FK `family_members.id` ON DELETE CASCADE |
| `donor_group` | `varchar(16)` | NOT NULL, CHECK 5절 6개 값 |
| `deduction_category` | `varchar(20)` | NOT NULL. 5절 규칙으로 저장 시 결정 |
| `gifted_on` | `date` | NOT NULL |
| `asset_type` | `varchar(16)` | NOT NULL, CHECK `cash, listed_stock, real_estate, other` |
| `amount` | `bigint` | NOT NULL, CHECK `> 0` |
| `appraisal_fee` | `bigint` | NOT NULL, default 0 |
| `marriage_birth_claimed` | `boolean` | NOT NULL, default false |
| `tax_paid` | `bigint` | NOT NULL, default 0. 실제 낸 증여세 |
| `filed` | `boolean` | NOT NULL, default false |
| `memo` | `varchar(200)` | NULL |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

인덱스 `(user_id, recipient_id, gifted_on)`.

관계별 허용 그룹(어기면 `422`, `field: "donorGroup"`, "이 가족에게 맞지 않는 증여자입니다."): `spouse` ← `spouse`, `child` ← `parents`·`grandparents`·`relative`·`non_relative`, `grandchild` ← `grandparents`·`parents`·`relative`·`non_relative`, `parent` ← `children`·`relative`·`non_relative`, `other_relative` ← `relative`·`non_relative`.

### 9.3 02와의 관계

- 사전 채움(`GET /api/estate/inheritance/prefill`, 방향 비교의 기본 재산)은 `app.modules.allocation.service.get_asset_breakdown`을 부른다. 02와 병렬 개발이므로 이 작업 브랜치에는 그 함수가 없다. **함수 import를 지연(함수 안에서 import)하고, `ImportError`·`AttributeError`면 `assets: null`로 응답한다.** 02 병합 뒤에는 실제 값이 나온다. 테스트는 두 경우를 모두 다룬다(`monkeypatch`).
- 자산 대응: 금융재산 = 배분 대상인 주식·채권·금·현금성 자산 합계, 기타 = 배분 대상인 기타 자산 합계, 부동산 = 점수 계산에서 뺀 자산 합계(실거주 주택 등). 화면에 "자산배분에서 점수 계산에서 뺀 자산은 부동산으로 채웠어요. 다르면 고쳐 주세요."를 보여 준다.

## 10. API 계약 (모두 인증 필요)

### 10.1 가족

| 메서드·경로 | 성공 |
| --- | --- |
| `GET /api/estate/members` | `200 {"items": [Member...]}` |
| `POST /api/estate/members` | `201 Member` |
| `PATCH /api/estate/members/{id}` | `200 Member` |
| `DELETE /api/estate/members/{id}` | `204`(기록도 삭제) |

- `Member`: `{"id", "relation", "displayName", "birthDate", "marriedOn", "childBirthDates", "parentDeceased", "age", "isMinor", "createdAt", "updatedAt"}`(`age`·`isMinor`는 오늘 KST 기준, 생년월일 없으면 null)

### 10.2 증여 기록

| 메서드·경로 | 성공 |
| --- | --- |
| `GET /api/estate/gifts?recipientId=` | `200 {"items": [Gift...]}` 날짜순 |
| `POST /api/estate/gifts` | `201 Gift` |
| `PATCH /api/estate/gifts/{id}` | `200 Gift` |
| `DELETE /api/estate/gifts/{id}` | `204` |

- `Gift`: 9.2 컬럼(camelCase) + `computedDeduction`, `computedMarriageBirthDeduction`, `estimatedTax`(6절 재생 결과로 응답 때 계산, 저장하지 않음)
- 검증: `gifted_on`은 수증자 생년월일 이후·오늘 이하, `amount` 1조 이하.

### 10.3 `GET /api/estate/members/{id}/deductions?asOf=2026-10-16`

```json
{ "asOf": "2026-10-16", "age": 16, "isMinor": true, "adultOn": "2029-03-01",
  "pools": [ { "category": "lineal_ascendant", "limit": 20000000, "usedWithin10y": 0, "available": 20000000, "nextResetOn": null } ],
  "marriageBirth": { "limit": 100000000, "used": 0, "available": 100000000, "eligibleNow": false, "windows": [ { "kind": "marriage", "from": "…", "to": "…" } ] },
  "ruleVersion": "KR-2024.01.01" }
```

- `pools`는 그 수증자에게 기록이 있거나 관계상 기본인 공제 구분만(자녀·손자녀는 `lineal_ascendant` 항상 포함).

### 10.4 `POST /api/estate/calc/gift-tax`

- 요청(가족 기준): `{"memberId": "…", "donorGroup": "parents", "giftedOn": "2026-10-16", "amount": 100000000, "appraisalFee": 0, "claimMarriageBirth": false, "useRecords": true}`
- 요청(직접 입력): `memberId` 대신 `"recipient": {"relation": "child", "birthDate": "1996-05-01", "marriedOn": null, "childBirthDates": [], "parentDeceased": false}`, `"priorGifts": [{"giftedOn", "donorGroup", "amount", "taxPaid", "marriageBirthClaimed"}]`
- 응답 `200`

```json
{ "steps": [ { "key": "giftAmount", "label": "이번 증여재산가액", "amount": 100000000, "note": null } ],
  "taxableValue": 100000000, "deduction": 50000000, "marriageBirthDeduction": 0, "taxBase": 50000000,
  "calculatedTax": 5000000, "surcharge": 0, "priorTaxCredit": 0, "filingCredit": 150000, "payableTax": 4850000,
  "notes": ["신고기한(증여일이 속한 달의 말일부터 3개월) 안에 신고한다고 가정했습니다."],
  "assumptions": ["…"], "ruleVersion": "KR-2024.01.01" }
```

- `steps.key` 순서: `giftAmount`, `aggregatedPrior`, `taxableValue`, `deduction`, `marriageBirthDeduction`, `appraisalFee`, `taxBase`, `calculatedTax`, `surcharge`, `priorTaxCredit`, `filingCredit`, `payableTax`. 각 `note`에 근거를 한국어로 적는다(예: "20% 구간, 누진공제 1,000만원").

### 10.5 `GET /api/estate/inheritance/prefill`

- `200 {"assets": {"financialAssets": 520000000, "realEstate": 300000000, "otherAssets": 0} | null, "spouse": true, "children": [{"memberId", "displayName", "age"}], "grandchildren": [{"memberId", "displayName", "age"}], "priorGiftsToHeirs10y": 30000000, "priorGiftsToNonHeirs5y": 0, "priorGiftDeductions": 30000000, "priorGiftTaxPaid": 0}`(`assets`는 9.3의 대응 규칙)
- 사전증여는 `parents`(자녀 수증)·`spouse` 그룹 기록을 상속인 10년, `grandparents`(손자녀 수증) 그룹 기록을 상속인 외 5년으로 센다. 화면에서 고칠 수 있다.

### 10.6 `POST /api/estate/calc/inheritance-tax`

- 요청: `{"financialAssets", "realEstate", "otherAssets", "debts", "financialDebts", "funeralExpense", "enshrinementExpense", "spouseAlive", "spouseActualShare": null, "children": [{"age": 35, "disabledLifeExpectancyYears": null}], "elderlyDependents": 0, "priorGiftsToHeirs10y", "priorGiftsToNonHeirs5y", "priorGiftDeductions", "priorGiftTaxPaid", "cohabitingHouse": {"eligible": false, "value": 0}, "appraisalFee": 0}`(금액은 모두 정수 원)
- 배우자도 자녀도 없으면 `422`(`field: "children"`, "이 계산기는 배우자와 자녀 상속만 다룹니다.").
- 응답 `200`: `steps`(장례비 공제, 과세가액, 기초+인적공제, 일괄공제, 배우자공제, 금융재산공제, 동거주택공제, 공제 합계, 종합한도, 적용 공제, 과세표준, 산출세액, 증여세액공제, 신고세액공제, 납부세액), 각 금액 필드, `notes`, `assumptions`, `ruleVersion`.

### 10.7 `POST /api/estate/simulate/gift-plan`

- 요청: `{"memberId": "…" | null, "birthDate": "2026-01-01" | null, "startDate": "2026-10-16" | null, "targetAge": 30, "annualReturnRate": "5", "donorGroup": "parents", "expectedMarriageDate": null}`(memberId와 birthDate 중 하나 필수)
- 응답 `200`

```json
{ "endDate": "2056-12-31",
  "schedule": [ { "giftOn": "2026-10-16", "age": 0, "amount": 20000000, "deductionType": "basic", "tax": 0 } ],
  "totalGifted": 140000000, "totalTax": 0, "futureValue": 273828999,
  "lumpSum": { "giftOn": "2056-12-31", "amount": 140000000, "taxBase": 90000000, "payableTax": 8730000 },
  "assumptions": ["…"], "ruleVersion": "KR-2024.01.01" }
```

### 10.8 `POST /api/estate/compare`

- 요청: `{"baseDate": "2026-10-16" | null, "horizonYears": 20, "annualGrowthRate": "3", "assets": {"financialAssets": 600000000, "realEstate": 900000000, "otherAssets": 0, "debts": 0} | null, "spouseAlive": true | null, "lumpSumPerChild": 100000000}`
- 자녀·손자녀·기존 증여 기록은 사용자의 가족 등록과 증여 기록에서 가져온다(`build_compare_input`). `assets`가 `null`이면 10.5의 사전 채움 값을 쓰고(`debts` 0), 그것도 없으면 `422`(`field: "assets"`, "재산 금액을 입력해 주세요."). `spouseAlive`가 `null`이면 가족에 배우자가 있는지로 정한다.
- 검증: `horizonYears` 1~40, `annualGrowthRate` 0~10, 금액 0~1조(일시 증여는 1 이상).
- 응답 `200`

```json
{ "baseDate": "2026-10-16", "horizonDate": "2046-10-16", "annualGrowthRate": "3",
  "scenarios": [
    { "key": "staged_children", "label": "자녀에게 10년마다 공제 한도만큼 증여",
      "gifts": [ { "memberId": "…", "displayName": "첫째", "giftOn": "2026-10-16", "amount": 50000000, "giftTax": 0 } ],
      "totalGifted": 200000000, "giftTaxTotal": 0, "giftsValueAtHorizon": 315086790,
      "estateAtHorizon": 2395177266, "inheritanceTax": 165000438, "totalTax": 165000438,
      "giftTaxAtHorizon": 0, "totalTaxAtHorizon": 165000438, "familyReceives": 2545263618,
      "inheritance": { "taxableValue": 2490177266, "appliedDeduction": 1723165451, "taxBase": 767011815, "payableTax": 165000438 } } ],
  "recommendedKey": "lump_sum_now",
  "notes": ["…"], "assumptions": ["…"], "ruleVersion": "KR-2024.01.01" }
```

### 10.9 `GET /api/estate/rules`

- `200 {"version", "effectiveFrom", "sources": [{"label", "url"}], "giftDeductions": {...}, "brackets": [{"upTo": 100000000 | null, "rate": "0.10", "progressiveDeduction": 0}]}`

## 11. 다른 모듈용 서비스 함수

```python
# app/modules/estate/service.py
def calc_gift_tax(req: GiftTaxInput) -> GiftTaxResult
def calc_inheritance_tax(req: InheritanceTaxInput) -> InheritanceTaxResult
def get_deduction_status(db, user_id, member_id: UUID, as_of: date) -> DeductionStatus
def simulate_gift_plan(req: GiftPlanInput) -> GiftPlanResult
def list_members(db, user_id) -> list[MemberInfo]          # 10.1의 Member와 같은 필드
def build_compare_input(db, user_id, *, base_date: date, horizon_years: int, growth_rate: Decimal,
                        lump_sum_per_child: int, assets: CompareAssets | None = None) -> EstateCompareInput
    # 가족(자녀·손자녀·배우자), 기존 증여 기록, 자산 사전 채움(9.3)을 모은다. 재산이 없으면 AppError 422(field "assets")
def compare_estate_plans(req: EstateCompareInput) -> EstateCompareResult   # 8.1. 순수 함수
```

- 계산 함수는 DB를 쓰지 않는 순수 함수다(가족·기록 조회는 라우터·`build_compare_input`이 해서 입력으로 넘긴다). 15(챗봇)가 쓴다.

## 12. 화면 명세 (`/estate`)

- 상단 고지 `Disclaimer variant="tax"`(모든 탭에서 보인다), 규칙 버전 배지("2024.01.01 시행 세법 기준").
- 탭(URL `?tab=`): 가족 / 증여 기록 / 공제 현황 / 증여세 계산 / 상속세 추정 / 분산 증여 플랜 / 방향 비교(`compare`)
- 가족: 카드 목록(관계, 별칭, 나이, 미성년 배지), 추가·수정 다이얼로그(관계별로 필수 항목 안내, 혼인신고일, 자녀 출생일 여러 개, 부모 사망 여부는 손자녀만).
- 증여 기록: 수증자 선택, 표(날짜, 증여자 그룹, 재산 종류, 금액, 적용 공제, 추정 세액, 낸 세금, 신고 여부), 추가·수정·삭제.
- 공제 현황: 가족마다 카드. 구분별 막대(사용 / 남음), 다음 공제 회복일, 성년 전환일, 혼인·출산 공제 상태와 기간.
- 증여세 계산: 가족 선택(또는 직접 입력), 증여자 그룹, 증여일, 금액(`formatKRWCompact` 도우미, 스펙 22 18절), 감정평가수수료, 혼인·출산 공제 신청 체크(조건 맞을 때만 활성). 결과는 단계 표(라벨·금액·근거)와 큰 납부세액.
- 상속세 추정: "내 정보로 채우기"(prefill, `assets`가 null이면 "자산배분에 자산을 입력하면 자동으로 채워집니다"), 입력 폼, 단계 표.
- 분산 증여 플랜: 수증자 선택, 목표 나이 슬라이더, 수익률, 예상 혼인일. 결과는 타임라인(나이·날짜·금액), 합계·미래가치, 한 번에 증여할 때 세금과 비교 카드, 누적 증여액·미래가치 선 그래프.
- 방향 비교: 입력(상속 가정 시점 슬라이더 1~40년과 "2046년 기준" 표시, 재산 증가율, 재산 4칸(금융·부동산·기타·채무, `formatKRWCompact` 도우미, "내 정보로 채우기"), 배우자 생존 스위치, 일시 증여 금액), 가족 요약(자녀·손자녀 수, 생년월일 없는 가족 안내). 결과는 방향 카드(데스크톱 2열, 모바일 1열: 이름, 가족에게 남는 금액, 총 세금(상속 시점 기준), 총 세금(낸 금액), 증여 합계·증여세·상속세. 17절), `recommendedKey` 카드에 "같은 가정에서 가장 많이 남는 방향" 배지, 방향별 상속 시점 기준 총 세금·남는 금액 막대 그래프(`BarChart`), 카드 펼치기(증여 일정 표, 상속세 단계 요약), `notes`. 자녀·손자녀가 없으면 "가족 탭에서 자녀를 등록하면 증여 방향을 비교할 수 있어요"와 `inherit_only`만 보여 준다.
- 모든 결과 화면 아래 "계산 가정" 접이식 목록(2절 제외 항목과 `assumptions`).

## 13. 테스트

### 백엔드 (`backend/tests/estate/`)

- 5절 사례 10개, 6절 재생 사례, 7절 사례 5개, 8절 사례(미래가치 ±100원), 8.1 사례 2개(±1,000원, `recommendedKey`)
- 방향 비교: 포함 조건(자녀·손자녀 유무), 생년월일 없는 가족 제외 `notes`, 배우자·자녀 없음 422, 기존 기록이 첫 회차 금액을 줄임, 예산(현재 금융재산)을 넘으면 증여를 줄임, 같은 값일 때 순서 규칙
- 경계: 증여 합산 1천만 직전·이상, 미성년→성년 전환일 전후, 혼인 기간 경계(±2년 당일), 과세표준 50만 직전, 할증 40% 조건, 배우자 단독상속 일괄공제 불가, 종합한도가 공제를 줄이는 사례
- 규칙 선택 `get_active_rules`(시행일 이전 날짜는 에러)
- 관계·그룹 검증 422, 기록 날짜 검증
- prefill·방향 비교 기본 재산: 02 함수 있음/없음 두 경우, 자산 대응 규칙
- 다른 사용자 가족·기록 404

### 프론트 (`frontend/tests/estate/`, MSW)

- 가족·기록 CRUD, 공제 현황 카드, 계산기 결과 단계 표, 플랜 타임라인, 방향 비교 카드·배지·막대·펼치기, 자녀 없음 안내, 고지 표시

## 14. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 5~8절과 8.1의 검증 사례가 모두 테스트로 고정돼 있다
- [ ] 모든 세금 화면에 `tax` 고지와 "계산 가정"이 있다

## 15. 검증 체크리스트

1. 4절 규칙 값을 국가법령정보센터 원문(조문 번호)과 대조한다. 다르면 차단 발견 사항으로 보고한다.
2. 5~8절 사례를 API로 직접 요청해 응답 값이 같은지 확인한다.
3. 계산 함수가 DB에 의존하지 않는 순수 함수다.
4. 원 단위 버림이 단계마다 적용된다.
5. 9.3절의 지연 import와 null 처리가 있다.
6. 10절 응답 필드·`steps.key` 순서·에러 코드가 같다.
7. 사용자 격리 404.
8. 8.1 방향 비교의 계산 순서(성장 계수, 회차일, 예산, 10년·5년 가산, 금융재산공제 축소)와 사례 값이 같다. 2번처럼 API로 직접 요청해 확인한다.
9. 방향 비교 화면과 응답이 "참고용" 표현만 쓰고 세무 판단을 대신하는 문장이 없다.

## 16. 다음 단계 연결점

- 15: `list_members`, `calc_gift_tax`, `get_deduction_status`, `simulate_gift_plan`, `build_compare_input`·`compare_estate_plans`를 챗봇 도구로 감싼다. 16도 `list_members`와 `get_deduction_status`를 쓴다.
- 세법이 바뀌면 `rules/kr_<시행일>.py`를 추가하고 `get_active_rules`가 날짜로 고르게 한다(유산취득세 전환안은 2026-10 현재 국회 미통과).

## 17. 증여세 낸 시점을 맞춘 방향 비교 (2026-10-23 사용자 결정, 브랜치 `feature/06-estate-compare-timing`)

- 문제: 8.1 5단계가 증여할 때 낸 증여세를 낸 금액 그대로 가족에게 남는 금액에서 빼고 총 세금에 더했다. 증여 자산은 T까지 불린 값(`giftsValueAtHorizon`)을 더하면서, 증여세로 나간 돈은 불리지 않아 지금 큰돈을 증여하는 방향이 유리하게 나왔다. 스펙 22 19절과 같은 문제다.
- 사용자 결정: 증여세도 낸 날부터 T까지 같은 증가율로 불려 계산한다.
- 새 응답 필드(`CompareScenario`, 정수 원)
  - `giftTaxAtHorizon`(백엔드 `gift_tax_at_horizon`) = 증여마다 `V(giftTax, giftOn)`(기존 `future_value`, 원 미만 버림)의 합
  - `totalTaxAtHorizon`(`total_tax_at_horizon`) = `giftTaxAtHorizon + inheritanceTax`
- 바뀌는 값: `familyReceives` = `estateAtHorizon − inheritanceTax + giftsValueAtHorizon − giftTaxAtHorizon`. `recommendedKey`의 동률 기준은 `totalTaxAtHorizon`. `notes`에 한 줄을 더한다(8.1).
- 그대로인 값: 증여 일정, `totalGifted`, `giftTaxTotal`, `giftsValueAtHorizon`, `estateAtHorizon`, `inheritanceTax`, `totalTax`(낸 금액 그대로), `inheritance`.
- 함께 고친 절: 8.1 5·6단계와 `notes`, 사례 1 표(두 열 추가, `lump_sum_now` 가족에게 남는 금액), 사례 2 설명, 사례 3(새로 추가), 10.8 예, 12 방향 비교.
- 화면(12 방향 비교, `features/estate/components/Compare.tsx`)
  - 방향 카드의 금액 목록: "총 세금" 한 줄을 "총 세금(상속 시점 기준)"(`totalTaxAtHorizon`)과 "총 세금(낸 금액)"(`totalTax`) 두 줄로 바꾼다. 나머지(증여 합계·증여세·상속세)는 그대로다.
  - `BarChart`의 세금 막대는 `totalTaxAtHorizon`, 범례 "총 세금(상속 시점 기준)". `ariaLabel`도 "방향별 상속 시점 기준 총 세금과 가족에게 남는 금액"으로 바꾼다.
- 15 챗봇 `compare_estate_plans` 도구와 카드는 바꾸지 않는다. 가족에게 남는 금액과 추천 방향은 이 계산을 그대로 써서 새 값이 되고, 카드의 총 세금은 낸 금액 그대로 보인다.
- 소유 파일: `backend/app/modules/estate/calculations.py`·`schemas.py`, `backend/tests/estate/**`, `frontend/src/features/estate/**`, `frontend/tests/estate/**`, 이 문서 `## 구현 결과` 끝의 새 소절. DB·마이그레이션·다른 모듈은 바꾸지 않는다.
- 확인: 백엔드·프론트 공통 완료 기준과 아래.
  - 사례 1·2·3 표 전체(성장률이 0이 아닌 사례는 금액마다 ±1,000원 허용. 위 식대로면 원 단위까지 같다)와 `recommendedKey`(사례 1 `lump_sum_now`, 사례 2 `inherit_only`, 사례 3 `staged_children`).
  - 증가율 0%면 모든 방향에서 `giftTaxAtHorizon == giftTaxTotal`, `totalTaxAtHorizon == totalTax`.
  - `POST /api/estate/compare` 응답의 두 필드. 15 챗봇 도구 테스트가 그대로 통과한다.
  - 화면 테스트: 방향 카드의 두 줄, 차트 범례.
  - 슬롯 06 서버에서 `/estate?tab=compare`를 사례 1 입력으로 360·1280px에서 확인한다(가로 스크롤 없음).

## 구현 결과

### 구현한 것

- `estate_0001` 브랜치 마이그레이션으로 가족·증여 기록 테이블, 같은 모듈 내 삭제 연쇄, 사용자·수증자·날짜 인덱스를 추가했다.
- 10절의 인증 API 전체와 11절의 공개 서비스 함수를 구현했다. 기록 CRUD는 사용자 범위로 조회하며 다른 사용자의 가족·기록·계산 입력은 404다.
- 시행일별 불변 규칙 파일과 DB·시계에 의존하지 않는 계산 함수(`calculations.py`)를 분리했다. 기본·혼인출산 공제 재생, 동일 그룹 합산, 누진세·세대생략 할증·세액공제, 상속 공제·종합한도, 분산 증여·복리 미래가치, 방향 비교의 금융 예산·사전증여 가산을 구현했다.
- 자산배분 공개 함수는 함수 안에서 지연 import한다. 실제 `AssetBreakdown.included_by_class`·`excluded_total` 대응과 ImportError·AttributeError 폴백을 테스트했다.
- `/estate?tab=`의 일곱 탭, 가족·기록 CRUD 다이얼로그, 공제 카드, 직접 입력·가족 기준 증여세, 상속세 사전 채움·단계표, 분산 증여 타임라인·선 그래프, 방향 비교 카드·막대 그래프·상세 펼치기를 구현했다. 모든 탭에 `tax` 고지와 계산 가정을 표시한다.
- 국가법령정보센터의 상속세 및 증여세법 제13·18~26·47·53·53의2·55~57·69조와 시행령 제9조, 민법 제4조를 참조해 규칙을 구성했다. 배우자 법정한도·종합한도 등 단순화는 본문의 계약과 화면 계산 가정을 따른다.

### 스펙 해석과 세부 결정

- 코디네이터 확인에 따라 시행일 이전 기록도 생성·수정·재생할 수 있다. 과거 기록의 공제와 추정 세액은 현재 규칙으로 다시 계산하되 혼인·출산 공제는 2024-01-01 이후 기록에만 적용한다. 직접 증여세 계산에서 2024-01-01 이전 증여일은 `field_error("giftedOn", "2024년 1월 1일 이후 증여만 계산할 수 있어요.")`다. `get_active_rules` 자체의 시행일 이전 에러도 유지한다. 화면에 "2024년 1월 1일 이전 기록도 현행 규칙으로 다시 계산한 추정치예요."를 표시했다.
- API에 이름이 지정되지 않았던 상속세 결과 금액·단계 키는 `funeralDeduction`, `basicPersonalDeduction`, `lumpSumDeduction`, `spouseDeduction`, `financialDeduction`, `cohabitingHouseDeduction`, `totalDeduction`, `deductionLimit`, `appliedDeduction`, `taxableValue`, `taxBase`, `calculatedTax`, `giftTaxCredit`, `filingCredit`, `payableTax`를 사용한다. 단계 순서는 10.6을 따른다.
- 상속세 화면의 자녀 입력은 쉼표로 나이를 구분하고, 장애인 공제가 필요하면 `나이:기대여명 연수`로 입력한다. 생년월일 없는 가족 제외 안내는 기존 데이터에도 대응한다.
- 새 의존성·공유 파일 변경은 없다. 이 모듈은 LLM·외부 금융 API를 호출하지 않는다.

### 완료 기준 검증

| 검증 | 결과 |
| --- | --- |
| `scripts/worktree-setup.sh` | 슬롯 06 준비 성공 |
| `uv run ruff check .` | 통과 |
| `uv run ruff format --check .` | 148개 파일 통과 |
| `uv run pytest` | 762개 통과(estate 30개 포함) |
| 별도 빈 DB `uv run alembic upgrade heads` → `downgrade base` → `upgrade heads` | 통과, 임시 DB 삭제 완료 |
| `npm run lint` | 통과, 경고 없음 |
| `npx tsc --noEmit` | 통과 |
| `npm run test` | 26개 파일·293개 테스트 통과(estate 8개 포함) |
| `npm run build` | 통과, `/estate` 생성 확인 |
| 실서버 API | 증여세 1억·상속세 30억·분산 증여 사례·방향 비교 사례 1·2 값 일치 |
| 독립 Playwright 세션 | UI 가입·기본정보·가족 추가·방향 비교 결과 확인 |
| 360px·1280px 일곱 탭 | `scrollWidth === innerWidth`, `tax` 고지 확인 |
| 방향 비교 결과 레이아웃 | 360px 한 열·가로 넘침 없음, 1280px 두 열(각 480px) 확인 |
| 보안·소유 범위 | 사용자 격리 404, 외부 HTTP 차단 픽스처 사용, 변경 경로 모두 3절 범위 |

5절 사례 10개, 6절 재생 사례, 7절 사례 5개, 8절 미래가치·일정, 8.1 사례 2개와 경계·예산·포함 조건·동률 순서를 테스트로 고정했다. 공통 완료 기준과 14절 완료 기준을 모두 확인했다.

### 남은 일

- 구현 범위의 남은 일은 없다. PR에 대한 별도 검증 워커 실행과 병합은 코디네이터가 진행한다.

### 검증 지적 수정 (2026-10-17)

- `origin/develop`의 갱신된 기타친족 범위와 숫자 뒤 소문자 별칭 계약을 병합했다.
- estate 스키마 전체에서 숫자가 들어간 필드 5곳을 확인하고 `usedWithin10y`, `priorGiftsToHeirs10y`, `priorGiftsToNonHeirs5y`를 `Field(alias=...)`로 명시했다. 실제 API 응답의 키 집합과 값, 상속세 요청의 소문자 키를 회귀 테스트로 검증한다.
- 검증 코멘트의 사전증여 요청은 과세가액 **895,000,000원**, 납부세액 **50,585,500원**이다. 상속인 외 사전증여 2천만원을 추가한 요청도 별도로 고정해 `5y` 입력의 반영을 확인했다.
- 가족 관계·증여 기록·증여세의 기타친족 선택 안내에 현행 **4촌 이내 혈족·3촌 이내 인척**과 **2025-03-14 전 증여의 종전 6촌 이내 혈족·4촌 이내 인척**을 표시했다. 규칙 파일의 근거 주석에 법률 제20777호(2025-03-14 시행) 부칙 제4조를 기록했으며 공제 금액은 변경하지 않았다.
- 증여 기록 표의 관리 열을 왼쪽 첫 열로 옮기고 고정했다. 360px에서 가로 스크롤 0일 때 수정 버튼은 x=41~85.16, 삭제 버튼은 x=89.16~133.31이며, 데이터 열을 끝까지 가로 스크롤해도 같은 위치에 남는다. 독립 로그인 세션에서 실제 수정·삭제까지 확인했다.
- 실제 백엔드를 사용한 360px 화면에서 공제 현황이 "사용 50,000,000원 · 남음 0원"으로 표시되고 `NaN`이 없음을 확인했다. 상속세 "내 정보로 채우기" 후 10년·5년 사전증여 입력이 각각 100,000,000원·0원으로 채워지고, 계산 요청과 결과가 위 회귀 사례와 일치한다.
- 재검증: `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`(**765개, estate 33개**), `npm run lint`, `npx tsc --noEmit`, `npm run test`(**293개**), `npm run build` 모두 통과했다. 별도 빈 DB의 `upgrade heads` → `downgrade base` → `upgrade heads`도 통과했고 임시 DB는 삭제했다.
- 새 의존성·마이그레이션·공유 파일 직접 수정은 없다. 수정 범위의 남은 일은 없으며 별도 재검증과 병합은 코디네이터가 진행한다.
