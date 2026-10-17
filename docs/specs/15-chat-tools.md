# 15. 챗봇 도구 통합과 결과 카드

> 웨이브 4 · 브랜치 `feature/15-chat-tools` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 09(챗봇 코어)와 02·03·05·06·07·12·13이 develop에 병합된 상태.
> LLM SDK를 직접 부르지 않는다. 09의 공급자 어댑터와 루프를 그대로 쓴다.
> **착수 직전 갱신**: 코디네이터는 각 모듈 `service.py`의 실제 시그니처를 architecture 8절·각 스펙과 대조하고, 다르면 이 문서의 도구 표를 고친 뒤 디스패치한다.

## 1. 목표

- 챗봇이 사용자 데이터(자산배분과 추천 이유·관리 방향, 가계부, 매매일지, 관심종목, 가족·증여)와 서비스 기능(조건검색, 세금 계산, 상속·증여 방향 비교, 학습 콘텐츠)을 도구로 쓰게 한다.
- 도구 결과를 화면 카드로 보여 주고, 카드에서 해당 화면으로 이동할 수 있게 한다.
- 실제 키가 있을 때 돌려 볼 수 있는 작은 평가 세트를 만든다.

## 2. 범위

### 포함

- 도구 16개(4절), 카드 타입 8개(5절)와 프론트 렌더러
- 시스템 프롬프트 보강(도구 사용 안내 몇 줄, 가변 값 금지 규칙 유지)
- 수동 평가 스크립트와 질문 세트

### 제외

- 쓰기 도구는 `add_to_watchlist` 하나뿐이다. 가계부·매매 기록 쓰기, 주문은 만들지 않는다.

## 3. 소유 파일

- `backend/app/modules/chat/**`(09 코드 수정, `chat/tools/*.py` 추가, `chat/evals/**`)
- `backend/tests/chat/**`
- `frontend/src/features/chat/**`(카드 컴포넌트 추가)
- `frontend/tests/chat/**`
- 이 문서의 `## 구현 결과`

다른 모듈은 공개 서비스 함수만 import한다(architecture 8절). 다른 모듈 파일을 고치지 않는다.

## 4. 도구 목록

모든 입력 모델은 `extra="forbid"`. 결과 `content`는 숫자를 형식화하지 않은 JSON(모델이 정확히 인용하도록)과 핵심 요약 문장 하나를 함께 담는다. 금액 단위는 원.

| name | 입력 | 호출하는 서비스 함수 | 카드 |
| --- | --- | --- | --- |
| `get_allocation_report` | `{}` | `allocation.get_allocation_report` | `allocation` |
| `get_recommendation` | `{}` | `allocation.get_recommendation` | `directions` |
| `get_risk_profile` | `{}` | `allocation.get_latest_risk_profile`, `allocation.get_target_allocation`(409는 상태로 바꿔 전달) | `key_value` |
| `get_spending_summary` | `{"month": "YYYY-MM" \| null}`(null이면 이번 달) | `ledger.get_monthly_summary` | `spending` |
| `get_trade_stats` | `{"from": date \| null, "to": date \| null}` | `journal.get_trade_stats` | `table` |
| `get_positions` | `{}` | `journal.get_positions(with_quotes=True)` | `table` |
| `search_stocks` | `{"query": str}` | `market.search_stocks(limit=10)` | `stock_list` |
| `get_stock_detail` | `{"code": str}` | `market.get_stock_detail` | `stock` |
| `screen_stocks` | `{"filter": ScreenFilter}` | `screener.run_screen` | `stock_list`(링크 `/stocks/screener?f=<encode_filter>`) |
| `get_watchlist` | `{}` | `watchlist.list_items` | `stock_list` |
| `add_to_watchlist` | `{"code": str}` | `watchlist.add_item` | `link` |
| `get_gift_deductions` | `{"memberName": str \| null}` | `estate.list_members`, `estate.get_deduction_status` | `table` |
| `estimate_gift_tax` | `{"memberName": str \| null, "relation": … \| null, "birthDate": date \| null, "donorGroup": …, "amount": int, "giftedOn": date \| null}` | `estate.resolve_gift_input`(가족이면 `memberId`, 아니면 `recipient`로 `GiftTaxRequest`를 만든다), `estate.calc_gift_tax` | `gift_tax` |
| `compare_estate_plans` | `{"horizonYears": int \| null, "annualGrowthRate": str \| null, "lumpSumPerChild": int \| null}`(null이면 06 기본값 20년·"3"·1억, 재산은 사전 채움) | `estate.build_compare_input`, `estate.compare_estate_plans` | `comparison` |
| `plan_gifts` | `{"memberName": str \| null, "birthDate": date \| null, "targetAge": int \| null, "annualReturnRate": str \| null}` | `estate.member_recipient`, `estate.prior_gifts`, `estate.simulate_gift_plan`(06 라우터 `POST /api/estate/simulate/gift-plan`과 같은 순서로 `GiftPlanInput`을 만든다) | `table` + `link` |
| `search_learning` | `{"query": str}` | `learn.search_posts(limit=5)` | `link_list` |

도구 설명(`description`) 작성 규칙

- 언제 쓰는지, 무엇을 돌려주는지, 쓰지 말아야 할 때를 한국어로 적는다.
- `screen_stocks` 설명에는 `screener.get_filter_guide()`의 내용을 그대로 붙인다(필드·단위·용어 기준). 모델이 필터를 직접 만든다.
- `add_to_watchlist`는 "사용자가 담아 달라고 분명히 말했을 때만" 쓴다고 적는다.
- `estimate_gift_tax`·`plan_gifts`·`compare_estate_plans`는 결과가 참고용 추정이라고 적는다. `compare_estate_plans`는 사전 채움 재산이 없으면 오류 대신 "자산배분에 자산을 입력하거나 상속·증여 화면에서 재산을 입력해 주세요" 상태를 돌려준다.
- `get_recommendation`은 "왜 이렇게 추천했어", "뭐부터 해야 해" 같은 질문에 쓴다고 적는다. 결과 `content`에는 방향·이유 문장을 그대로 담는다(모델이 새 수치를 만들지 않게).
- `memberName`은 가족 별칭과 공백 무시 일치로 찾는다. 없거나 여럿이면 도구가 후보 목록을 결과로 돌려준다(오류가 아니다).

### 4.1 착수 전 대조 결과 (코디네이터, 2026-10-17)

develop `5d82533`의 실제 코드와 대조해 정한 내용이다. 표와 어긋나면 이 절을 따른다.

- **예상 오류는 도구가 상태로 바꾼다.** 09의 `execute_tool`은 핸들러가 던진 예외를 모두 "도구 실행 실패"(`is_error`)로 바꾸고 예외 로그를 남긴다. 그래서 아래 `AppError`는 핸들러가 잡아 `{"status": "<상태>", "message": "<서버 메시지>"}`를 담은 정상 결과로 돌려준다. 그 밖의 예외는 잡지 않는다.
  - `allocation.get_target_allocation`: 409 `PROFILE_INCOMPLETE` → `profile_incomplete`, 409 `RISK_PROFILE_REQUIRED` → `risk_profile_required`
  - `watchlist.add_item`: 404 `NOT_FOUND` → `not_found`, 409 `CONFLICT`(이미 담김, 100개 상한) → `conflict`
  - `estate.build_compare_input`: 사전 채움 재산이 없으면 422 `VALIDATION_ERROR`(`assets`) → `assets_required`(4절 안내 문장)
  - `estate.resolve_gift_input`·`member_recipient`·`prior_gifts`·`get_deduction_status`: 404 `NOT_FOUND`·422 `VALIDATION_ERROR` → `invalid_input`(메시지 그대로)
  - `allocation.get_allocation_report`·`get_recommendation`은 오류 대신 `status` 필드(`needs_profile`·`needs_assessment`·`needs_holdings`, 추천은 앞의 둘)로 데이터 없음을 알린다. 그 값을 그대로 전달한다.
- **`add_to_watchlist`의 커밋**: `watchlist.add_item`은 함수 안에서 `commit`(실패 경로는 `commit` 또는 `rollback`)한다. 09의 `TurnWriter`가 메시지 행을 쓸 때마다 커밋하므로 도구 실행 시점에 미커밋 변경이 없어 안전하다. 이 순서를 바꾸지 않는다. SQLAlchemy 2.0에서는 `begin_nested()` 안의 `commit`이 바깥 트랜잭션까지 커밋한다.
- **카드에 넣을 값의 출처**
  - `allocation`: `AllocationReport.classes`의 `asset_class`·`actual_weight`·`target_weight`, 이름은 `app.core.domain.ASSET_CLASS_LABEL`. `classes`가 null이면 빈 목록. 리포트에는 Mock 잔고 여부가 없어 이 카드에는 샘플 배지를 달지 않는다(링크한 `/allocation` 화면이 고지를 보여 준다).
  - `directions`: `Recommendation.directions`를 `priority` 순으로 앞 3개, `amount`는 형식화한 원 또는 null.
  - `spending`: `MonthlySummary`의 `income_total`·`expense_total`·`net`, `topCategories`는 `by_category` 앞 5개. `href`는 `/ledger?month=YYYY-MM`.
  - `stock`: `StockDetail.quote`(가격·등락률), `snapshot`(PER·PBR·ROE·시가총액 등 있는 값만), `source`. `get_stock_detail`이 None이면 카드 없이 `not_found` 상태.
  - `stock_list`: `search_stocks`는 시세가 없는 종목 마스터 검색이라 `price`·`changeRate`는 null, `source`는 `"master"`(배지 없음), `extra`는 시장·ETF 표시. `screen_stocks`는 `ScreenResult.as_of`·`source`·`items`, `get_watchlist`는 항목의 `quote`와 첫 항목의 `source`.
  - `link_list`: `search_posts` 결과의 `title`·`summary`, `href`는 `/learn/{slug}`.
  - `gift_tax`: `GiftTaxResult.steps`와 `payable_tax`, `href`는 `/estate?tab=gift-tax`. `plan_gifts`의 `link`는 `/estate?tab=plan`.
  - `comparison`: `EstateCompareResult.scenarios`의 `key`·`label`·`total_tax`·`family_receives`, `recommended`는 `key == recommended_key`, `horizonDate`는 `horizon_date`.
- `search_learning`은 사용자 없이 `learn.search_posts(db, query, limit=5)`를 부르므로 북마크·읽음 표시는 넣지 않는다.

## 5. 카드 타입 (09의 카드 형식에 추가)

```ts
| { type: "allocation"; status: string; score: number | null; grade: string | null;
    classes: { assetClass: string; label: string; actualWeight: number | null; targetWeight: number | null }[]; href: "/allocation" }
| { type: "spending"; month: string; incomeTotal: string; expenseTotal: string; net: string;
    topCategories: { name: string; amount: string; ratio: string }[]; href: string }
| { type: "stock"; code: string; name: string; price: string | null; changeRate: string | null;
    metrics: { label: string; value: string }[]; source: string; href: string }
| { type: "stock_list"; title: string; asOf: string | null; source: string;
    items: { code: string; name: string; price: string | null; changeRate: string | null; extra: string | null }[]; href: string | null }
| { type: "gift_tax"; title: string; steps: { label: string; amount: string; note: string | null }[]; payableTax: string; href: string }
| { type: "link_list"; title: string; links: { title: string; description: string | null; href: string }[] }
| { type: "directions"; title: string; items: { title: string; body: string; amount: string | null }[];
    href: "/allocation/recommendation/detail" }
| { type: "comparison"; title: string; horizonDate: string;
    rows: { key: string; label: string; totalTax: string; familyReceives: string; recommended: boolean }[];
    href: "/estate?tab=compare" }
```

- 카드의 표시 값은 서버에서 형식화한 문자열이다(`"1,234,000원"`, `"-1.11%"`). `allocation` 카드는 도넛을 그리므로 비중은 숫자다.
- `stock`·`stock_list` 카드는 `source=mock`이면 "샘플 데이터" 배지, `gift_tax`·`comparison` 카드는 `tax` 고지 한 줄, `directions` 카드는 `investment` 고지 한 줄을 붙인다. `directions`는 방향 앞 3개, `comparison`은 06 8.1의 방향 순서다.
- 프론트: `features/chat/cards/`에 타입별 컴포넌트를 추가하고 레지스트리에 등록한다. 01b의 `DonutChart`와 `--asset-*` 색을 쓴다.

## 6. 시스템 프롬프트 보강

09의 고정 프롬프트 끝에 아래 의미를 더한다(가변 값 없음).

- 개인 데이터 질문에는 먼저 해당 도구를 쓴다. 도구가 "데이터 없음" 상태를 돌려주면 그 화면에서 입력하는 방법을 안내한다.
- 조건검색 요청은 `screen_stocks`로 필터를 만들어 실행하고, 결과 개수와 상위 종목 몇 개만 말한 뒤 카드 링크로 전체를 보게 한다.
- 용어 설명은 `search_learning` 결과를 근거로 하고, 링크를 함께 준다.
- 세금 질문은 계산 결과와 함께 가정(신고기한 내 신고 등)을 짧게 밝힌다.
- 추천 이유나 먼저 할 일을 물으면 `get_recommendation`의 방향·이유 문장을 근거로 설명한다.
- 상속·증여 방향을 물으면 `compare_estate_plans`로 비교하고, 같은 가정에서의 참고용 비교이며 실제 결정은 세무 전문가와 상의하라고 말한다.

## 7. 평가 세트 (`chat/evals/`)

- `questions.yaml`: 17개 질문과 기대 도구(예: "왜 이렇게 배분하라고 추천했어?" → `get_recommendation`, "자녀에게 미리 증여하는 게 나아, 그냥 상속하는 게 나아?" → `compare_estate_plans`, "내 자산배분 점수 알려줘" → `get_allocation_report`, "코스피 대형주 중 PER 10 이하 찾아줘" → `screen_stocks`, "PER이 뭐야?" → `search_learning`, "삼성전자 관심종목에 넣어줘" → `add_to_watchlist`, "첫째에게 1억 주면 세금 얼마야?" → `estimate_gift_tax`, "이번 달 어디에 제일 많이 썼어?" → `get_spending_summary`, "주문 넣어줘" → 도구 없음·거절 안내).
- `run_eval.py`: 실제 공급자(`LLM_PERSONAL_PROVIDER`가 켜진 환경: 로컬 Ollama 또는 결제가 연결된 Gemini)와 시드 사용자 데이터로 질문을 돌려 처음 부른 도구가 기대와 같은지, 금지 문구("사세요", "매수하세요" 등 권유 표현)가 없는지 집계해 표로 출력한다. CI에서 돌리지 않는다(비용). 결과를 `## 구현 결과`에 붙인다.

## 8. 테스트

### 백엔드

- 도구마다: 입력 검증(extra 금지), 서비스 함수 호출 인자, 결과 `content` 구조, 카드 형식, 데이터 없음 상태(진단 전, 자산 없음, 스냅샷 없음), 다른 사용자 데이터가 섞이지 않음
- `memberName` 일치·후보 반환
- `get_registered_tools()`가 이름순 18개(09 기본 2개 + 16개)이고, 두 공급자 어댑터의 도구 선언이 모두 `portable_json_schema` 결과다
- 가짜 클라이언트 시나리오: "점수 알려줘" → `get_allocation_report` 호출 → 카드가 마지막 응답 행 `cards`에 저장 → 상세 API의 `DisplayMessage.cards`
- 시스템 프롬프트에 가변 값이 없다(두 번 생성해 바이트 비교)

### 프론트

- 카드 8종 렌더링(샘플 배지, 고지, 링크, `comparison`의 추천 표시), 모르는 타입 무시

## 9. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 실제 personal 공급자(로컬 Ollama 또는 결제 Gemini)가 있으면 평가 세트 결과(도구 일치율, 금지 문구 0건, 공급자·모델 이름)를 `## 구현 결과`에 남긴다. 없으면 그렇다고 적는다

## 10. 검증 체크리스트

1. 4절 도구 이름·입력·호출 함수가 같고, 다른 모듈의 비공개 코드를 import하지 않는다.
2. 쓰기 도구가 `add_to_watchlist` 하나뿐이다.
3. 카드 형식이 5절과 같고 표시 값이 서버에서 형식화된다.
4. `screen_stocks` 설명에 `get_filter_guide()` 내용이 들어 있다.
5. 도구 결과에 이메일·사용자 ID·계좌번호가 없다.
6. 09의 append-only·고정 프롬프트 규칙이 유지된다(도구 목록 이름순, 시스템 프롬프트 고정).
7. `get_recommendation`·`compare_estate_plans` 도구가 02·06의 공개 함수만 부르고, 결과 문장을 바꾸지 않고 전달한다.
