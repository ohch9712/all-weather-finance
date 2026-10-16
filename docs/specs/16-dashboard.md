# 16. 홈 대시보드

> 웨이브 4 · 브랜치 `feature/16-dashboard` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 02·03·05·06·07·12가 develop에 병합된 상태.
> **착수 직전 갱신**: 코디네이터는 각 모듈 서비스 함수의 실제 반환 필드를 확인해 3절 응답을 맞춘다.

## 1. 목표

- 로그인하면 가장 먼저 보는 홈(`/`)에 내 상태를 한눈에 보여 준다: 배분 점수와 먼저 할 일(02 추천의 첫 번째 관리 방향), 이번 달 가계부, 매매 성과, 관심종목, 증여 공제 여유, 오늘의 용어, AI 상담 바로가기.
- 처음 쓰는 사용자에게는 할 일 체크리스트(투자성향 진단, 목표·상황 입력, 자산 입력, 가계부 첫 기록, 관심종목 담기)를 보여 준다.
- 한 모듈이 실패해도 나머지 카드는 보인다.

## 2. 범위

- 백엔드 `GET /api/dashboard/summary`(한 번의 요청으로 모든 카드 데이터)
- 화면 `/`(01b 자리표시 교체)
- 제외: 위젯 배치 사용자 설정, 알림

## 3. API 계약 `GET /api/dashboard/summary` (인증 필요)

```json
{
  "greetingName": "감자",
  "allocation": { "status": "ready", "score": 80, "grade": "A", "scoreDelta": 3,
                  "classes": [ { "assetClass": "stock", "actualWeight": 50.0, "targetWeight": 32.5 } ],
                  "topDirection": { "kind": "reserve_short_term_goal", "title": "'내 집 마련' 자금은 안전하게",
                                    "body": "2028년 10월에 쓸 2,000만원은 …", "href": "/allocation/recommendation/detail" } | null } | null,
  "ledger": { "month": "2026-10", "incomeTotal": 3500000, "expenseTotal": 1820000, "expenseChangeRate": -9.45,
              "topCategories": [ { "name": "식비", "amount": 520000, "ratio": 28.57 } ] } | null,
  "journal": { "monthRealizedPnl": [ { "currency": "KRW", "realizedPnl": "74040" } ], "winRate": 50.0, "openPositionCount": 3 } | null,
  "watchlist": { "items": [ { "code": "005930", "name": "삼성전자", "price": "71200", "changeRate": -1.11 } ], "source": "mock" } | null,
  "estate": { "members": [ { "memberId": "…", "displayName": "첫째", "available": 20000000, "nextResetOn": null } ] } | null,
  "learn": { "today": PostSummary | null, "readCount": 12, "publishedCount": 35 } | null,
  "chat": { "enabled": true, "location": "local" },
  "checklist": [ { "key": "risk_assessment", "label": "투자성향 진단하기", "done": true, "href": "/allocation/survey" },
                 { "key": "situation", "label": "목표·상황 입력하기", "done": false, "href": "/allocation/situation" },
                 { "key": "holdings", "label": "보유 자산 입력하기", "done": false, "href": "/allocation/assets" },
                 { "key": "ledger_entry", "label": "가계부 첫 기록 남기기", "done": false, "href": "/ledger" },
                 { "key": "watchlist", "label": "관심종목 담기", "done": false, "href": "/stocks/watchlist" } ],
  "errors": [ { "section": "watchlist", "code": "BROKER_UNAVAILABLE" } ]
}
```

- 섹션마다 해당 모듈의 공개 서비스 함수만 부른다: `allocation.get_allocation_report`·`get_recommendation`(`directions`의 첫 항목, 진단 전이면 `topDirection: null`), `ledger.get_monthly_summary`(이번 달), `journal.get_trade_stats`(이번 달)·`get_positions`, `watchlist.list_items`(앞 5개), `estate.list_members` + `get_deduction_status`(자녀·손자녀만, 최대 3명), `learn.get_term_of_the_day` + 진도, 챗봇 활성 여부와 처리 위치(`app.integrations.llm.status.get_ai_status()`의 personal). 체크리스트 `situation`은 상황이 저장돼 있거나 목표가 하나 이상이면 완료다.
- 섹션 함수가 예외를 던지면 그 섹션은 `null`, `errors`에 `{section, code}`(AppError면 코드, 아니면 `INTERNAL_ERROR`)를 넣고 로그를 남긴다. 응답 전체는 `200`이다.
- 데이터가 비어 있는 것은 오류가 아니다(예: 관심종목 0개 → `items: []`).
- 섹션 조회는 순서대로 실행한다(동기 세션 하나). 전체 응답 시간 목표 500ms 이하(Mock 기준).

## 4. 화면 명세 (`/`)

- 인사: "안녕하세요, {greetingName}님"(닉네임 없으면 이메일 앞부분), 오늘 날짜.
- 체크리스트 카드: 모두 완료하면 숨긴다. 진행률 표시.
- 카드 격자(데스크톱 3열, 태블릿 2열, 모바일 1열)
  - 자산배분: 점수·등급·변화, 작은 도넛(실제 비중), "먼저 할 일" 한 줄(`topDirection`의 제목, 누르면 `href`), 상태가 `ready`가 아니면 다음 단계 버튼
  - 이번 달 가계부: 수입·지출·전월 대비, 상위 카테고리 3개 막대
  - 매매 성과: 이번 달 실현손익(통화별), 승률, 보유 종목 수
  - 관심종목: 5개 미니 목록(등락 색), 샘플 배지, "더 보기"
  - 증여 공제: 자녀별 남은 공제와 다음 회복일(가족이 없으면 "가족 등록하기")
  - 오늘의 용어: 용어·한 줄 정의·"자세히", 학습 진도 막대
  - AI 상담: 예시 질문 3개 버튼(누르면 위젯을 열고 그 질문을 입력창에 채운다. 하나는 "왜 이렇게 배분하라고 추천했어?"), `AiProviderBadge scope="personal" compact`, LLM 꺼짐이면 안내
- 섹션이 `null`이면 그 카드에 "불러오지 못했어요" + 다시 시도.
- 하단 `Disclaimer variant="investment"`.

## 5. 소유 파일

- `backend/app/modules/dashboard/**`
- `backend/tests/dashboard/**`
- `frontend/src/app/(app)/page.tsx`
- `frontend/src/features/dashboard/**`
- `frontend/tests/dashboard/**`
- 이 문서의 `## 구현 결과`
- 챗봇 위젯은 09가 공개한 `openChatWidget({ draft })`(`features/chat/index.ts`)로만 연다. 채팅 모듈 파일은 고치지 않는다.

## 6. 테스트

- 백엔드: 새 사용자(모든 섹션 비어 있음, 체크리스트 5개 전부 미완료, `topDirection: null`), 상황·목표 입력 뒤 `situation` 완료와 `topDirection`, 데이터가 있는 사용자(Mock 시드), 한 섹션 서비스가 예외 → 그 섹션만 null과 `errors`, 다른 사용자 데이터가 섞이지 않음
- 프론트: 카드별 렌더링, null 섹션 재시도, 체크리스트 완료 시 숨김, 반응형 열 수

## 7. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 신규 가입 직후와 데이터가 채워진 뒤 두 상태에서 홈이 자연스럽게 보인다

## 8. 검증 체크리스트

1. 공개 서비스 함수만 호출한다.
2. 섹션 실패 격리(한 섹션 예외가 전체 200을 깨지 않음).
3. 3절 응답 필드가 같다.
4. 360px에서 카드가 한 열로 깨짐 없이 보인다.
