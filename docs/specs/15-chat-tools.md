# 15. 챗봇 도구 통합과 결과 카드

> 웨이브 4 · 브랜치 `feature/15-chat-tools` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 09(챗봇 코어)와 02·03·05·06·07·12·13이 develop에 병합된 상태.
> 구현 워커는 시작 전에 claude-api 스킬(Python)을 읽는다.
> **착수 직전 갱신**: 코디네이터는 각 모듈 `service.py`의 실제 시그니처를 architecture 8절·각 스펙과 대조하고, 다르면 이 문서의 도구 표를 고친 뒤 디스패치한다.

## 1. 목표

- 챗봇이 사용자 데이터(자산배분, 가계부, 매매일지, 관심종목, 가족·증여)와 서비스 기능(조건검색, 세금 계산, 학습 콘텐츠)을 도구로 쓰게 한다.
- 도구 결과를 화면 카드로 보여 주고, 카드에서 해당 화면으로 이동할 수 있게 한다.
- 실제 키가 있을 때 돌려 볼 수 있는 작은 평가 세트를 만든다.

## 2. 범위

### 포함

- 도구 14개(4절), 카드 타입 6개(5절)와 프론트 렌더러
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
| `estimate_gift_tax` | `{"memberName": str \| null, "relation": … \| null, "birthDate": date \| null, "donorGroup": …, "amount": int, "giftedOn": date \| null}` | `estate.calc_gift_tax` | `gift_tax` |
| `plan_gifts` | `{"memberName": str \| null, "birthDate": date \| null, "targetAge": int \| null, "annualReturnRate": str \| null}` | `estate.simulate_gift_plan` | `table` + `link` |
| `search_learning` | `{"query": str}` | `learn.search_posts(limit=5)` | `link_list` |

도구 설명(`description`) 작성 규칙

- 언제 쓰는지, 무엇을 돌려주는지, 쓰지 말아야 할 때를 한국어로 적는다.
- `screen_stocks` 설명에는 `screener.get_filter_guide()`의 내용을 그대로 붙인다(필드·단위·용어 기준). 모델이 필터를 직접 만든다.
- `add_to_watchlist`는 "사용자가 담아 달라고 분명히 말했을 때만" 쓴다고 적는다.
- `estimate_gift_tax`·`plan_gifts`는 결과가 참고용 추정이라고 적는다.
- `memberName`은 가족 별칭과 공백 무시 일치로 찾는다. 없거나 여럿이면 도구가 후보 목록을 결과로 돌려준다(오류가 아니다).

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
```

- 카드의 표시 값은 서버에서 형식화한 문자열이다(`"1,234,000원"`, `"-1.11%"`). `allocation` 카드는 도넛을 그리므로 비중은 숫자다.
- `stock`·`stock_list` 카드는 `source=mock`이면 "샘플 데이터" 배지, `gift_tax` 카드는 `tax` 고지 한 줄을 붙인다.
- 프론트: `features/chat/cards/`에 타입별 컴포넌트를 추가하고 레지스트리에 등록한다. 01b의 `DonutChart`와 `--asset-*` 색을 쓴다.

## 6. 시스템 프롬프트 보강

09의 고정 프롬프트 끝에 아래 의미를 더한다(가변 값 없음).

- 개인 데이터 질문에는 먼저 해당 도구를 쓴다. 도구가 "데이터 없음" 상태를 돌려주면 그 화면에서 입력하는 방법을 안내한다.
- 조건검색 요청은 `screen_stocks`로 필터를 만들어 실행하고, 결과 개수와 상위 종목 몇 개만 말한 뒤 카드 링크로 전체를 보게 한다.
- 용어 설명은 `search_learning` 결과를 근거로 하고, 링크를 함께 준다.
- 세금 질문은 계산 결과와 함께 가정(신고기한 내 신고 등)을 짧게 밝힌다.

## 7. 평가 세트 (`chat/evals/`)

- `questions.yaml`: 15개 질문과 기대 도구(예: "내 자산배분 점수 알려줘" → `get_allocation_report`, "코스피 대형주 중 PER 10 이하 찾아줘" → `screen_stocks`, "PER이 뭐야?" → `search_learning`, "삼성전자 관심종목에 넣어줘" → `add_to_watchlist`, "첫째에게 1억 주면 세금 얼마야?" → `estimate_gift_tax`, "이번 달 어디에 제일 많이 썼어?" → `get_spending_summary`, "주문 넣어줘" → 도구 없음·거절 안내).
- `run_eval.py`: 실제 키(`LLM_MODE=anthropic`)와 시드 사용자 데이터로 질문을 돌려 처음 부른 도구가 기대와 같은지, 금지 문구("사세요", "매수하세요" 등 권유 표현)가 없는지 집계해 표로 출력한다. CI에서 돌리지 않는다(비용). 결과를 `## 구현 결과`에 붙인다.

## 8. 테스트

### 백엔드

- 도구마다: 입력 검증(extra 금지), 서비스 함수 호출 인자, 결과 `content` 구조, 카드 형식, 데이터 없음 상태(진단 전, 자산 없음, 스냅샷 없음), 다른 사용자 데이터가 섞이지 않음
- `memberName` 일치·후보 반환
- `tool_definitions()`가 이름순 16개(09 기본 2개 + 14개)이고 모두 strict
- 가짜 클라이언트 시나리오: "점수 알려줘" → `get_allocation_report` 호출 → 카드가 마지막 응답 행 `cards`에 저장 → 상세 API의 `DisplayMessage.cards`
- 시스템 프롬프트에 가변 값이 없다(두 번 생성해 바이트 비교)

### 프론트

- 카드 6종 렌더링(샘플 배지, 고지, 링크), 모르는 타입 무시

## 9. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 실제 키가 있으면 평가 세트 결과(도구 일치율, 금지 문구 0건)를 `## 구현 결과`에 남긴다. 키가 없으면 그렇다고 적는다

## 10. 검증 체크리스트

1. 4절 도구 이름·입력·호출 함수가 같고, 다른 모듈의 비공개 코드를 import하지 않는다.
2. 쓰기 도구가 `add_to_watchlist` 하나뿐이다.
3. 카드 형식이 5절과 같고 표시 값이 서버에서 형식화된다.
4. `screen_stocks` 설명에 `get_filter_guide()` 내용이 들어 있다.
5. 도구 결과에 이메일·사용자 ID·계좌번호가 없다.
6. 09의 append-only·캐싱 규칙이 유지된다(도구 목록 이름순, 시스템 프롬프트 고정).
