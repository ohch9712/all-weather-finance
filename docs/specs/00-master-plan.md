# 00. 마스터 설계 계획: 개인 자산배분 금융 플랫폼

> 전체 설계의 최상위 문서다. 2026-10-16 계획 모드에서 사용자가 승인한 계획을 그대로 옮겼다.
> 단계별 계약은 `docs/specs/01~18`, 공통 규칙은 `AGENTS.md`, 구조는 `docs/architecture.md`, 진행 절차는 `docs/roadmap.md`에 있다.
> 문서끼리 어긋나면 이 문서가 우선이다. 결정이 바뀌면 이 문서부터 고치고 하위 문서를 맞춘다.

## Context

- 저장소는 비어 있다. `main`에 빈 Initial commit만 있고, `CLAUDE.md`(미커밋)는 존재하지 않는 `@AGENTS.md`를 가리킨다. 원격 저장소는 없다. Orca에는 등록돼 있다(repo id `5c07c49e-6263-4f45-bf2b-d995226a1433`). GitHub CLI는 `ohch9712` 계정으로 로그인돼 있다(`repo` 권한).
- 만들 제품: 나이대(20~60대)와 투자성향 설문으로 권장 자산배분(주식·채권·금·현금·기타)을 정하고, 보유 자산을 입력하면 배분 일치 점수를 매긴다. 여기에 가계부(카드 명세서 업로드·수동 입력), 주식 매매일지(파일 업로드·수동 입력), 관심종목, AI 자연어 조건검색(키움·토스 API), 상속·증여 플래너(증여재산공제 반영), 주린이 학습 게시판, AI 챗봇 에이전트, 가능하면 마이데이터 자동 수집을 더한다.
- 사용자가 정한 진행 방식:
  - 설계를 먼저 끝낸다. 이번 세션 범위는 **설계 문서 + 브랜치 준비까지**이고, 워커 디스패치는 설계 검토 후 별도 지시로 한다.
  - 워커 분할은 **모듈 단위 수직 분할**이다. 한 워커가 한 모듈의 백엔드와 프론트를 함께 맡는다.
  - 구현 워커는 **혼합**이다. 백엔드 비중이 큰 작업은 codex, 화면 비중이 큰 작업은 claude가 맡는다.
  - **구현 후 검증은 전부 codex `gpt-6.1-sol` / effort `xhigh` 워커가 맡는다.**
  - 병합은 **GitHub 비공개 저장소 + develop 대상 PR**로 한다. 저장소 생성은 승인됐다.
  - Vercel은 필수가 아니다.
- 따라서 이번 결과물은 코드가 아니다. **워커들이 서로 대화 없이 병렬 구현할 수 있는 계약 문서 세트**와 **GitHub 원격·develop·1웨이브 워크트리 준비**다. 문서 형식은 사용자의 gamja-market 방식(`AGENTS.md` + `docs/specs/NN-*.md`)을 따른다.

## 조사로 확인한 외부 제약 (설계에 반영)

| 대상 | 확인 내용 | 설계 반영 |
| --- | --- | --- |
| 토스증권 Open API | 2026-08 정식 서비스. REST 전용, OAuth2 client credentials, **허용 IP 등록 필수**, 모의투자 없음. 시세·종목정보·랭킹·계좌·보유·주문조회 제공. 스크리닝·재무지표·관심종목 API 없음 | 조회 전용 어댑터. 주문 API는 쓰지 않는다 |
| 키움 REST API | **허용 IP 등록 필수**(최대 10개). 모의투자 도메인 있음(KRX만). 조건검색은 웹소켓으로 **HTS에서 미리 만든 조건식만 실행**(API로 조건식 생성 불가). `ka10001`이 PER·PBR·ROE·시가총액 등 47개 필드 제공. 값은 부호 붙은 문자열, 업무 오류도 HTTP 200 + `return_code`. 공식 Python 런타임·CLI·MCP 제공(GitHub Kiwoom-Securities/Kiwoom-REST-API) | 자연어 조건검색은 "LLM → 구조화 필터 → 증권사 API로 만든 종목 스냅샷 조회"로 구현. 키움 저장 조건식 실행은 보조 기능 |
| 마이데이터 | 본인신용정보관리업 허가 사업자만 API 접근 가능 | 직접 연동 불가. `DataConnector` 인터페이스 + CODEF 데모(일 100회) 커넥터 + 마이데이터 스텁 |
| 증여·상속 세법 (2026-10 현재) | 증여재산공제(10년 합산) 배우자 6억, 직계존속→성년 5천만, 미성년 2천만, 기타친족 1천만. 혼인·출산 공제 1억(합산 한도). 세율 10~50% 누진. 유산취득세 전환안은 국회 미통과 | 세법 수치를 시행일이 붙은 **규칙 버전 파일**로 분리. 계산 결과는 참고용 고지 |
| 투자성향 등급 | 금융투자협회 표준 5등급, 점수 구간 20/40/60/80 | 설문 점수 → 5등급 매핑 |
| 배포 | 두 증권사 모두 허용 IP 등록이 필요해 **고정 아웃바운드 IP**가 필요하다(VPS 또는 Vercel Static IPs) | 호스팅 결정은 마지막 작업(18)으로 미룬다. 개발은 로컬 IP 등록으로 진행 |
| Gemini API (2026-10 확인, 변경 기록 참고) | 권장 API는 Interactions API(2026-06 GA, `generateContent`는 레거시지만 계속 지원). 기본으로 대화를 서버에 저장한다(`store=true`, 유료 55일·무료 1일). `store=false`로 끌 수 있다. **무료 등급은 입력·응답이 Google 제품 개선에 쓰이고 사람이 검토할 수 있으며, 약관이 민감·개인정보를 보내지 말라고 한다.** `gemini-3.8-flash`는 안정 버전이고 무료 등급이 있으며 구조화 출력·함수 호출·thinking(low/medium/high)을 지원한다. 안전 차단은 HTTP 400 + `code: "safety"`, 출력 한도는 `status: "incomplete"`. Python SDK는 `google-genai`(2.31) | 개인 데이터가 없는 작업만 Gemini로 보낸다. 항상 `store=False`. 개인 데이터 작업은 결제가 연결된 키(`GEMINI_BILLING_ENABLED=true`)일 때만 Gemini를 허용 |
| Ollama (로컬 LLM) | Python `ollama` 0.6.3: `chat`의 `tools`·`format`(JSON 스키마)·`think`·`stream`·`images`. 공식 `gemma4` 모델(e2b·e4b·12b·26b·31b)이 도구·이미지·사고를 지원하고 12b는 약 8GB다. PDF는 직접 받지 않는다 | 개인 금융 데이터 작업(챗봇, 카드·증권 파일 처리)의 기본 공급자. PDF는 `pypdfium2`로 쪽을 PNG로 바꿔 이미지로 넣는다 |

## 핵심 설계 결정

| 항목 | 결정 |
| --- | --- |
| 스택 | gamja-market과 동일: Next.js(App Router) + TypeScript + Tailwind, FastAPI + Python(uv) + SQLAlchemy 2.0(동기) + Alembic, Postgres 17(Docker), 테스트 Vitest·pytest. 차트 Recharts, UI는 shadcn/ui |
| 코드 구조 | **모듈 우선 구조**. `backend/app/modules/<module>/{router,schemas,service,repository,models}.py`, `frontend/src/features/<module>/`. 모듈 디렉터리 = 워커의 파일 소유 범위 |
| 인증 | gamja-market 방식 이식: 이메일·비밀번호, argon2id, 서버 세션 + HttpOnly 쿠키. 프로필에 출생연도(나이대 계산) |
| 공통 규칙 | JSON camelCase, 금액은 정수 원(KRW), 통일 에러 포맷 `{error:{code,message,details}}`, 시각 ISO 8601 UTC |
| AI | **데이터 등급별 공급자**(2026-10-16 변경, 처음 계획은 Claude API). 개인 데이터가 없는 작업(학습 글 초안, 조건 문장 해석)은 Gemini API(`google-genai` Interactions API, `gemini-3.8-flash`), 개인 금융 데이터 작업(챗봇, 카드·증권 파일 처리)은 로컬 Ollama(`gemma4:12b`). 공급자는 환경변수로 바꾸고, 개인 등급은 결제가 연결된 Gemini 키일 때만 Gemini로 보내며 자동 전환(폴백)하지 않는다. 모든 LLM 호출은 01a의 공통 계층을 거치고, 작업 등록부가 등급·effort·max_tokens를 정한다. SDK 호출 형태는 공식 문서와 설치 패키지 소스에서 확인해 architecture 9.1에 적는다. 테스트는 가짜만 쓰고 실제 API를 호출하지 않는다 |
| 외부 데이터 | 모든 외부 원천은 어댑터 뒤에 둔다(`Mock` 기본, `Kiwoom`, `Toss`, `Codef`). Mock 데이터는 화면에 "샘플 데이터"로 표시 |
| 안전 | 주문·매매 실행 기능 없음(조회 전용). 증권사·CODEF 자격증명은 Fernet 암호화 저장, 로그 마스킹. 업로드 파일은 파싱 후 폐기. 투자 권유가 아닌 정보 제공이라는 고지와 세무 참고용 고지 |

## 모듈 맵

| 모듈 | 기능 | 주요 화면 | 주요 테이블 |
| --- | --- | --- | --- |
| `auth` | 가입·로그인·세션·프로필(출생연도) | `/login` `/signup` `/onboarding` | users, sessions, user_profiles |
| `allocation` | 투자성향 설문, 목표·상황, 목표 반영 권장 배분, 관리 방향·추천 이유, 자산 입력, 배분 점수·등급·리밸런싱·점수 이력 | `/allocation` `/allocation/survey` `/allocation/situation` `/allocation/assets` `/allocation/recommendation` `/allocation/recommendation/detail` | risk_assessments, holdings, allocation_scores, allocation_situations, financial_goals |
| `ledger` | 수입·지출 수동 입력, 카테고리, 월간 요약 | `/ledger` | ledger_entries, ledger_categories |
| `imports` | 공통 파일 임포트 엔진: CSV·XLSX·XLS·HTML형 xls 파싱, 헤더 탐지, 동의어 사전, LLM 컬럼 매핑, 미리보기, 커밋 | 공용 매핑 UI 컴포넌트 | import_jobs |
| `journal` | 매매일지(체결 + 매수 이유·복기 메모·태그), 이동평균법 손익, 승률·달력 | `/journal` | trades, trade_notes |
| `market` | 증권사 어댑터, 종목 마스터, 시세, 종목 스냅샷 배치, 증권사 연결 설정 | `/settings/connections` | stocks, stock_snapshots, broker_connections |
| `watchlist` | 관심종목, 종목 검색, 종목 상세 | `/stocks/watchlist` `/stocks/[code]` | watchlist_items |
| `screener` | 필터 DSL, 자연어→필터(LLM), 결과 표, 키움 저장 조건식 실행 | `/stocks/screener` | saved_screens |
| `estate` | 가족 등록, 증여 이력, 10년 공제 잔여, 증여세·상속세 계산, 분산 증여 시뮬레이터, 상속·증여 방향 비교 | `/estate` | family_members, gift_records |
| `learn` | 글·영상(YouTube)·용어 게시판, 북마크·읽음, 관리자 작성 | `/learn` `/learn/glossary` `/admin/learn` | posts, bookmarks |
| `chat` | AI 에이전트(공급자 어댑터: 로컬 Ollama 기본·Gemini 선택, 대화 저장, SSE, 도구 레지스트리), 채팅 화면·위젯 | `/chat` + 전 화면 위젯 | chat_conversations, chat_messages |
| `connectors` | CODEF 데모 커넥터(카드 승인내역·계좌 잔액), 마이데이터 스텁 | `/settings/connections` | connector_syncs |

## 도메인 규칙 요약 (상세 수치는 각 스펙에 기록)

- **투자성향 설문**: 나이는 나이대로 따로 반영하므로 점수에서 뺀다. 투자기간·경험·금융지식·수입 안정성·투자 비중·손실 감내 6문항 → 0~100점 → 5등급(20/40/60/80 구간).
- **권장 배분**: 나이대 5개 × 성향 5개 = 25칸 표. 위험자산(주식+기타) 비중 = `100 − 대표나이(25/35/45/55/65) + 성향 보정(−30/−15/0/+10/+20)`을 10~90으로 제한한다. 나머지를 채권·금·현금으로 나누고 나이가 많을수록 현금을 늘린다. 표는 데이터 파일로 두고, 모든 칸의 합이 100인지 테스트한다.
- **목표 반영 권장 배분**: 상황(월 생활비, 부양가족, 고금리 대출)과 목표(금액, 목표일)를 받아 층을 쌓는다. 비상금(생활비 3개월, 부양가족이 있거나 수입이 불안정하면 6개월)은 현금성 자산, 1년 안 목표는 현금성 자산, 3년 안 목표는 채권, 나머지는 나이대·성향 표 비중이다. 상황·목표가 없으면 표 값 그대로다.
- **관리 방향과 추천 이유**: 고금리 대출 상환 → 비상금 채우기 → 가까운 목표 자금 → 5%p 이상 어긋난 자산군 조정 → 장기 목표 순서의 규칙 문장(먼저 할 일)과, 나이대·성향·답변별 점수·층별 근거를 담은 이유 문장을 보여 준다. 자산군 단위로만 말하고 상품·종목을 권하지 않는다. 핵심 흐름은 가입 시 정보 입력 → 추천 결과 → 상세 설명이다.
- **배분 점수**: `100 − Σ|실제 비중 − 권장 비중| ÷ 2`(퍼센트포인트, 권장은 목표 반영 값). 등급 S/A/B/C/D, 자산군별 차이 막대, 목표까지 사고팔 금액, 점수 이력 차트. 실거주 부동산은 기본적으로 점수 계산에서 뺀다.
- **증여 플래너**: 수증자별 10년 롤링 공제 사용액과 잔여액(직계존속은 부모를 동일인으로 합산), 혼인·출산 공제, 누진세율, 세대생략 할증(30%, 미성년·20억 초과 40%), 신고세액공제 3%. 분산 증여 일정 제안(0·10·20·30세, 혼인·출산 시점)과 일시 증여 대비 세금 비교. 상속세 추정은 일괄공제·배우자공제·금융재산공제·사전증여 합산(상속인 10년, 비상속인 5년)·공제 종합한도까지 반영한다.
- **상속·증여 방향 비교**: 가족 구성(배우자·자녀·손자녀)과 자산 정보로 증여 없이 상속, 자녀 10년 주기 분산 증여, 지금 일시 증여, 손자녀 분산 증여를 같은 성장률·상속 가정 시점으로 계산해 총 세금과 가족에게 남는 금액을 비교한다. 참고용이다.
- **자연어 조건검색**: LLM이 화이트리스트 필드·연산자로만 된 JSON 필터를 만든다. 백엔드가 검증한 뒤 SQL로 바꿔 최신 스냅샷을 조회한다. 지원하지 않는 조건은 버리지 않고 "적용 못 한 조건"으로 돌려준다.

## 작업 분해(DAG), 브랜치, 구현 에이전트

모든 브랜치는 `develop`에서 만들고 PR로 `develop`에 병합한다. 이름 규칙은 `feature/<NN>-<slug>`이고 스펙 번호와 같다. 구현 에이전트의 모델은 지정하지 않아 사용자 기본값을 따른다. 검증은 모든 작업 공통으로 codex `gpt-6.1-sol` / `xhigh`다.

| 웨이브 | 작업 | 브랜치 | 선행 | 구현 |
| --- | --- | --- | --- | --- |
| 1 | 01a 백엔드 기반 + 인증·프로필 + 전 모듈 스텁·라우터 등록 + LLM 공통 계층(Gemini·Ollama, 데이터 등급별 선택) + 인프라(compose, 스크립트, 워크트리 설정, orca.yaml) | `feature/01-foundation-backend` | 없음 | codex |
| 1 | 01b 프론트 기반 + 디자인 시스템 + 앱 셸·내비 + 전 모듈 자리표시 페이지 + 인증·온보딩 화면 | `feature/01-foundation-frontend` | 없음 | claude |
| 2 | 02 자산배분 (설문·목표·상황·목표 반영 권장 배분·관리 방향·추천 이유·자산 입력·점수·이력 차트) | `feature/02-allocation` | 01 | claude |
| 2 | 03 가계부 수동 입력·월간 요약 차트 | `feature/03-ledger` | 01 | claude |
| 2 | 04 공통 파일 임포트 엔진 | `feature/04-imports` | 01 | codex |
| 2 | 05 매매일지 수동 입력·손익 통계 | `feature/05-journal` | 01 | codex |
| 2 | 06 상속·증여 플래너(세금 계산 엔진·시뮬레이터·방향 비교) | `feature/06-estate` | 01 | codex |
| 2 | 07 학습 게시판(글·영상·용어, 시드 콘텐츠) | `feature/07-learn` | 01 | claude |
| 2 | 08 증권사 게이트웨이·종목 마스터·시세·스냅샷 배치 | `feature/08-market` | 01 | codex |
| 2 | 09 AI 챗봇 코어(공급자 어댑터·에이전트 루프·SSE·채팅 UI) | `feature/09-chat-core` | 01 | claude |
| 3 | 10 카드 명세서 업로드·자동 분류 | `feature/10-ledger-import` | 03, 04 | codex |
| 3 | 05b 매매 수수료·세금 기본 요율 설정과 추정 | `feature/05-journal-costs` | 05, 08b | codex |
| 3 | 11 매매내역 업로드 + 증권사 체결 동기화 | `feature/11-journal-sync` | 04, 05, 05b, 08, 08b | codex |
| 3 | 08b 종목 마스터에 국내 ETF 추가 | `feature/08-market-etf` | 08 | codex |
| 3 | 12 관심종목·종목 상세 | `feature/12-watchlist` | 08, 08b | claude |
| 3 | 13 AI 조건검색(필터 DSL·자연어 해석·결과 화면) | `feature/13-screener` | 08, 08b | codex |
| 3 | 14 증권사 잔고 → 자산 자동 반영 | `feature/14-holdings-sync` | 02, 08 | codex |
| 4 | 15 챗봇 도구 통합(전 모듈) + 결과 카드 UI | `feature/15-chat-tools` | 09, 02, 03, 05, 06, 07, 12, 13 | claude |
| 4 | 16 홈 대시보드 | `feature/16-dashboard` | 02, 03, 05, 12 | claude |
| 4 | 17 CODEF·마이데이터 커넥터 | `feature/17-connectors` | 10, 14 | codex |
| 5 | 18 배포(호스팅·고정 IP·시크릿·백업) | `feature/18-deploy` | 전체, 호스팅 결정 후 | codex |

## 구현 → 검증 → 병합 흐름 (docs/roadmap.md에 명령까지 기록)

1. **구현**: 코디네이터가 작업 NN의 task spec(roadmap의 복사용 블록)으로 구현 워커를 띄운다. 1웨이브는 미리 만든 워크트리를 `--worktree branch:feature/01-...`로 고른다. 2웨이브부터는 디스패치 때 `--worktree new-top-level --name feature/NN-<slug> --base-branch develop`으로 만든다. 구현 워커는 완료 기준 통과 후 커밋·푸시하고 `gh pr create --base develop`으로 PR을 연 다음 PR URL을 담아 `worker_done`을 보낸다.
2. **검증**: 코디네이터가 구현 작업에 의존하는 `NN-verify` 작업을 같은 워크트리에서 띄운다.
   ```text
   orca orchestration worker-start --task <NN-verify task id> --worktree branch:feature/NN-<slug> --agent codex --model gpt-6.1-sol --effort xhigh --json
   ```
   검증 워커는 코드를 고치지 않는다. 완료 기준 명령 재실행, 스펙 계약(경로·필드·상태코드·에러 코드) 대조, 소유 경로 위반 확인(`git diff --name-only develop...HEAD`), 빈 DB에서 마이그레이션 적용, 실제 외부 API·LLM 호출 부재, 보안 규칙을 점검한다. 결과 보고서를 `gh pr comment`로 PR에 남기고 통과면 `--outcome succeeded`, 실패면 지적 사항과 함께 `--outcome failed`로 끝낸다. 같은 계정의 PR은 GitHub에서 승인(approve)할 수 없으므로 코멘트로 남긴다.
3. **수정**: 실패하면 코디네이터가 지적 사항을 원래 구현 에이전트에게 다시 맡기고, 끝나면 새 검증을 띄운다. 통과할 때까지 반복한다.
4. **병합**: 검증 통과한 PR을 코디네이터가 `gh pr merge --merge`로 develop에 병합한다.
5. **웨이브 통합 검증**: 웨이브의 PR이 모두 병합되면 develop에서 codex `gpt-6.1-sol` / `xhigh` 워커가 전체 테스트, 빈 DB 마이그레이션, 두 서버 기동 후 핵심 흐름 스모크 테스트를 한다. 실패 항목은 해당 모듈 구현 에이전트에게 수정 작업으로 돌린다. 통과하면 develop → main 릴리스 PR을 연다.

## 병렬 작업 충돌 방지 규칙 (AGENTS.md에 명시)

1. **파일 소유권**: 워커는 자기 모듈 디렉터리, 자기 페이지 경로, 자기 테스트, 자기 마이그레이션, 자기 스펙 문서만 고친다. 공유 파일 수정이 필요하면 코디네이터에게 `ask`로 묻는다.
2. **기반 작업이 공유 파일을 미리 채운다**: 전 모듈의 라우터 등록(빈 스텁), 모델 import 목록, 내비게이션 항목, 자리표시 페이지, 예상 의존성 전부(백엔드: google-genai, ollama, pypdfium2, pillow, httpx, websockets, cryptography, pandas, openpyxl, xlrd, lxml, python-multipart 등, 프론트: recharts, react-markdown, zod, shadcn 관련)를 01에서 설치한다. 이후 워커는 의존성을 추가하지 않는다.
3. **마이그레이션은 모듈별 Alembic 브랜치**: 각 모듈은 `branch_labels=(<module>,)`를 단 자기 브랜치를 갖고 루트는 01의 foundation revision이다. revision ID는 스펙에서 미리 정한다(예: `allocation_0001`). 다른 모듈 테이블을 참조하면 `depends_on`으로 순서를 건다. 적용은 항상 `alembic upgrade heads`, 새 revision은 `--head <module>@head`로 만든다. 그래서 병렬 웨이브가 병합돼도 merge revision이 필요 없다.
4. **워크트리별 실행 환경 분리**: 01a가 `scripts/worktree-setup.sh`를 만든다. 브랜치 번호로 포트(백엔드 `8000+NN`, 프론트 `3000+NN`)와 DB 이름(`finance_NN`)을 정해 `.env`를 만들고, 공용 Postgres 컨테이너에 DB를 만들고, `uv sync`·`npm ci`·`alembic upgrade heads`를 실행한다. `orca.yaml`의 setup 스크립트로 연결하고, Orca가 인식하지 못하면 워커가 첫 단계로 직접 실행한다. gamja-market 기동 스크립트는 다른 워크트리의 서버를 종료하므로 그 부분은 이식하지 않는다.
5. **모듈 간 호출은 서비스 함수로만**: 각 스펙에 "다른 모듈이 쓰는 서비스 함수" 절을 둔다. 챗봇 도구(15)와 대시보드(16)는 이 함수만 호출한다.
6. **외부 API와 LLM은 테스트에서 가짜로 대체**: 실제 키 없이도 모든 테스트가 통과해야 한다.

## 설계 단계 준비 작업 (2026-10-16 수행)

1. **설계 문서 작성**
   - `docs/specs/00-master-plan.md`: **이 계획 문서 자체**를 전체 설계 문서로 저장한다. 단계별 스펙(01~18)의 상위 문서이고, 조사 출처 링크(토스·키움·CODEF·세법·투자성향 기준) 절을 덧붙인다. 다른 문서는 이 문서와 어긋나지 않게 쓰고, 결정이 바뀌면 이 문서부터 고친다.
   - `AGENTS.md`: 프로젝트 설명, 스택, 디렉터리 구조, 공통 규칙, 소유권·마이그레이션·의존성 규칙, AI·외부 API 규칙, 보안·고지, 브랜치·커밋·PR 규칙, 공통 완료 기준, 검증 워커 규칙, Next.js 문서 확인 규칙.
   - `docs/architecture.md`: 시스템 구성도, 모듈 경계, 데이터 모델 요약(ERD), 모듈 간 서비스 인터페이스, 외부 연동 제약, 보안 설계, AI 에이전트 설계와 SDK 호출 형태.
   - `docs/roadmap.md`: 웨이브·DAG(mermaid), 브랜치·워크트리·구현 에이전트 표, 구현→검증→병합 절차와 Orca·gh 명령 템플릿, 작업별 구현 task spec과 검증 task spec 복사용 블록(대상·변경·제약·소유·완료 기준).
   - `docs/specs/01-foundation.md` ~ `docs/specs/18-deploy.md`: 작업마다 목표, 범위(포함·제외), 선행 계약, 소유 파일, 기술 결정, DB 스키마와 revision ID, API 계약(경로·JSON·상태코드·에러 코드), 화면 명세, 도메인 규칙, 다른 모듈용 서비스 함수, 테스트·완료 기준, 검증 체크리스트, 다음 단계 연결점. 3웨이브 이후 스펙에는 착수 직전에 실제 코드와 대조해 갱신한다는 표시를 단다.
   - LLM을 쓰는 스펙(01·04·09·10·13·15)은 작성 전에 claude-api 스킬의 Python 문서를 읽고 호출 형태를 옮겨 적는다.
2. **main 커밋과 GitHub 원격**: `CLAUDE.md`와 문서를 `main`에 커밋한다. `gh repo create ohch9712/finance-project --private --source . --remote origin`으로 비공개 저장소를 만들고 `main`을 푸시한다. 저장소 이름은 폴더 이름 "금융 프로젝트"를 영어로 옮긴 것이다.
3. **develop**: `main`에서 `develop`을 만들어 푸시하고, 기본 체크아웃을 `develop`으로 바꾼다(gamja-market과 같은 배치). `orca repo set-base-ref --repo id:5c07c49e-6263-4f45-bf2b-d995226a1433 --ref develop --json`으로 Orca 워크트리 기본 기준을 `develop`으로 맞춘다.
4. **1웨이브 워크트리**: Orca로 2개를 만들고 각 브랜치를 upstream과 함께 푸시한다.
   ```text
   orca worktree create --repo id:5c07c49e-6263-4f45-bf2b-d995226a1433 --name feature/01-foundation-backend --base-branch develop --no-parent --json
   orca worktree create --repo id:5c07c49e-6263-4f45-bf2b-d995226a1433 --name feature/01-foundation-frontend --base-branch develop --no-parent --json
   ```
   2웨이브 이후 브랜치는 앞 웨이브 병합 직후의 `develop`에서 디스패치할 때 만든다. 미리 만들면 시작점이 낡기 때문이다.
5. 워커 디스패치는 하지 않는다. 디스패치 순서와 명령은 `docs/roadmap.md`에 남긴다.

### 수행 결과와 계획과 달라진 점 (2026-10-16)

- 설계 문서를 `main`에 커밋하고 비공개 저장소 `ohch9712/finance-project`를 만들어 `main`·`develop`을 올렸다. 기본 체크아웃은 `develop`이다.
- 계획에 적었던 Orca 저장소 id가 틀려(요청 id를 옮겨 적음) 실제 id `5c07c49e-6263-4f45-bf2b-d995226a1433`으로 문서를 고쳤다. Orca 기본 기준 브랜치는 `develop`으로 설정했다.
- 이 기기의 SSH 키가 암호로 보호돼 에이전트 셸에서 푸시할 수 없어, 이 저장소만 HTTPS 원격 + gh 자격 증명 도우미로 바꿨다(전역 설정은 그대로).
- Orca가 만든 브랜치 이름이 `ohch9712/feature-01-...` 형식이라 `feature/01-foundation-backend`, `feature/01-foundation-frontend`로 바꾸고 원격에 올렸다. 2웨이브부터의 절차는 `docs/roadmap.md` 4.3에 반영했다.
- 워커 디스패치는 하지 않았다.

## 설계 변경 기록

### 2026-10-16: 추천 흐름·방향 비교 추가, LLM 공급자 변경

사용자 요청 원문

- "자산 현황과 사용자 상황 목표에 맞는 자산 관리 방향 및 추천 이유 제시"
- "가족 구성 자산 정보를 활용한 상속 증여 방향 비교 참고 가능"
- "핵심 흐름: 가입 시 정보 입력 -> 추천 결과 -> 상세 설명"
- "gemini api로 일단 사용가능 하도록 반영해줘", "금융 정보라 애매하다고 판단되면 ollama를 통해 로컬 llm으로 처리해도 괜찮아."

반영

1. 추천 흐름(02): 목표·상황 입력, 목표 반영 권장 배분(층 쌓기), 관리 방향, 추천 이유와 답변별 점수, 온보딩 흐름(출생연도 → 투자성향 → 목표·상황 → 자산 간단 입력 → 추천 결과 → 상세 설명), 테이블 `allocation_situations`·`financial_goals`(revision `allocation_0001`에 포함). 사례 값은 스크립트로 검증했다.
2. 방향 비교(06 8.1): 네 방향의 총 세금과 가족에게 남는 금액, 10년·5년 사전증여 가산과 금융재산공제 축소까지 반영. 사례 2개를 스크립트로 검증했다. 자산 사전 채움은 02의 `get_asset_breakdown`(지연 import)이다.
3. 15(도구 `get_recommendation`·`compare_estate_plans`, 카드 `directions`·`comparison`), 16(먼저 할 일, 체크리스트 "목표·상황 입력하기")도 맞췄다.
4. LLM: 개인 금융 데이터가 들어가는 작업(챗봇, 카드·증권 파일 처리)은 Gemini 무료 등급 약관상 보내면 안 되므로 **로컬 Ollama가 기본**이다. 개인 데이터가 없는 작업(학습 글 초안, 조건 문장 해석)만 Gemini로 보낸다. 결제가 연결된 Gemini 키가 있으면 개인 작업도 Gemini로 바꿀 수 있다. Claude는 예약값으로 남기고, 이전 호출 형태는 커밋 `5560c39`에 있다. Anthropic 전용 기능(서버 측 거절 폴백, 캐시 표시, eager 도구 입력 스트리밍)은 함께 뺐다.
5. Gemini 챗봇은 라운드 단위로 받는다. Interactions 스트리밍의 도구 인자 조각 형식이 공식 문서(`arguments`·`partial_arguments`)와 SDK 2.31 소스(`arguments_delta`·`arguments`)에서 달라 이번 범위에서는 쓰지 않는다.
6. 01a에 `core/format.py`(서버 금액 문장), `GET /api/ai/status`, 의존성 `google-genai`·`ollama`·`pypdfium2`·`pillow`(`anthropic` 제외)를, 01b에 `AiProviderBadge`·`useAiStatus`를 넣었다. 1웨이브 브랜치는 커밋이 없어 이 변경이 든 `develop`으로 빨리 감기(fast-forward)했다.

### 2026-10-17: 종목 범위에 국내 ETF 추가, 웨이브 2 진행 중 계약 보완

사용자 결정

- 종목 검색·관심종목·조건검색의 대상은 **국내 주식 + 국내 ETF**다. 미국 주식·ETF는 별도 작업으로 미룬다(번호 미정). 키움 REST API 공식 명세(`Kiwoom-Securities/Kiwoom-REST-API` 커밋 `953e5db`)에 국내 ETF 목록(`ka10099` `mrkt_tp=8`)·ETF 전용 API(`ka40001`~`ka40010`)와 미국주식 API(`usa*`, 129개)가 있음을 확인했다.
- 키움 REST API 키는 배포 서버(고정 IP)를 정한 뒤 발급한다. 그때까지 개발·검증은 Mock으로 한다.
- 체결 수수료·세금 기본값은 키움증권 기준(국내주식 매매수수료 0.015%, 국내주식 매도 거래세 0.20%, 미국주식 매매수수료 0.25%)으로 두고, 증권사 이벤트 등으로 바뀔 수 있으니 사용자가 설정에서 바꿀 수 있게 한다. 국내 ETF 매도에는 거래세를 붙이지 않는다(증권거래세 비과세, 코디네이터 반영).

반영

1. 후속 작업 08b(`docs/specs/08b-market-etf.md`, 브랜치 `feature/08-market-etf`)를 만들고 12·13의 선행에 넣었다.
1-2. 후속 작업 05b(`docs/specs/05b-journal-costs.md`, 브랜치 `feature/05-journal-costs`, revision `journal_0002`)를 만들고 11의 선행에 넣었다. 11의 revision은 `journal_0003`으로 미뤘다. 08b에서 `Execution.fee`·`tax`를 None 허용(증권사 미제공)으로 바꿔 11이 사용자 요율로 추정한다.
2. 웨이브 2 진행 중 코디네이터가 고친 공통 계약: `AppError`의 `details`와 `field_error`(architecture 4.1), 숫자 뒤 소문자 필드 별칭 규칙(architecture 4), 08 `BrokerHolding.eval_amount: int | None`(원화 평가금액이 없는 외화 보유분), 백엔드 직접 의존성 `pyyaml`(07 시드 앞머리), 구조 테스트의 SSE 클라이언트 예외(09 `sse.ts`), 06 기타친족 범위를 2025-03-14 개정 상증세법(법률 제20777호)으로 갱신.

## 재사용할 기존 코드 (gamja-market, 사용자 본인 프로젝트)

- 백엔드: `backend/app/core/config.py`(psycopg URL 정규화 포함), `core/errors.py`(통일 에러 포맷), `core/security.py`·`core/cookies.py`·`core/cors.py`, `services/auth_service.py`, `repositories/{user,session}_repository.py`, `api/deps.py`(`get_db`, `CurrentUser`, `require_json`), `db/session.py`, `alembic/env.py`, `tests/conftest.py`(트랜잭션 롤백 픽스처). 모듈 우선 구조에 맞게 경로만 옮긴다.
- 프론트: `src/lib/api-client.ts`(타임아웃·에러 정규화), `src/features/auth/*`(AuthProvider, RequireAuth, 폼, 검증), `tests/setup.ts`, `vitest.config.mts`.
- 인프라: `compose.yaml`(Postgres 17, 헬스체크), `scripts/lib/common.sh`의 포트·로그 처리 일부.
- 문서 형식: `docs/specs/01-project-foundation.md`, `02-auth-signup-login.md`의 절 구성과 "계약" 서술 방식.

## 검증

- **문서 정합성**: `docs/specs/00-master-plan.md`가 이 계획과 같은 내용인지 확인한다. 스크래치 스크립트로 18개 스펙의 필수 절 존재, 로드맵의 브랜치·스펙 링크 유효성, 작업 간 소유 경로 중복 없음, DAG 순환 없음, 스펙의 테이블·엔드포인트·revision ID와 `docs/architecture.md`의 일치를 확인한다.
- **git·GitHub**: `git log --graph --oneline --all`로 `main`·`develop`·1웨이브 브랜치의 시작점을 확인한다. `git remote -v`, `gh repo view ohch9712/finance-project --json visibility,defaultBranchRef`로 비공개 여부를 확인한다. `git ls-remote --heads origin`으로 `main`·`develop`·1웨이브 브랜치가 원격에 있는지 본다.
- **Orca**: `orca worktree list --repo id:5c07c49e-6263-4f45-bf2b-d995226a1433 --json`으로 워크트리 2개가 `develop` 커밋에서 시작했는지 확인한다.
- 코드 테스트는 이번 범위에 없다. 각 작업의 완료 기준과 검증 체크리스트는 스펙에 적고, 실행은 검증 워커가 맡는다.

## 사용자에게 필요한 것 (구현 단계에서)

- 카드사·증권사 내보내기 파일 샘플(개인정보 제거). 없으면 파일 프리셋 대신 범용 헤더 탐지와 LLM 매핑만 만든다. 워커가 파일 형식을 지어내지 않게 한다.
- 실제 연동 시 키움·토스 앱키와 허용 IP 등록, Gemini API 키(개인 데이터 작업까지 Gemini로 보내려면 결제 연결), 로컬 LLM용 Ollama 설치와 `ollama pull gemma4:12b`(메모리 16GB 미만이면 `gemma4:e4b`), CODEF 데모 키. 없어도 Mock·가짜로 전 기능을 개발·테스트할 수 있다.

## 조사 출처

설계에 반영한 외부 사실의 출처다. 구현 워커는 수치·엔드포인트를 쓰기 전에 1차 출처(법령, 공식 문서)로 다시 확인한다.

### 증권사 API

- 토스증권 Open API 정식 서비스 기사: https://m.news.nate.com/view/20260813n31632
- 토스증권 Open API 정리(발급, 허용 IP, 호출 한도, 제공 API): https://algolab.co.kr/blog/toss-securities-open-api-guide-2026
- 토스증권 Open API 발급·이용법: https://www.baseload.co.kr/blog/2026-07-07-toss-securities-open-api-guide/
- 키움 REST API 공식 가이드: https://openapi.kiwoom.com/m/guide/apiguide
- 키움 공식 REST API 저장소(Python 런타임, CLI, MCP, 전체 API 스펙): https://github.com/Kiwoom-Securities/Kiwoom-REST-API
- 키움 앱키 발급과 IP 등록: https://algolab.co.kr/kiwoom-rest-key-guide
- 키움 조건검색 웹소켓(LOGIN → CNSRLST → CNSRREQ, PING 응답): https://algolab.co.kr/blog/kiwoom-rest-condition-search-websocket-2026
- 키움 `ka10001` 주식기본정보(47개 필드, 문자열·부호 주의): https://algolab.co.kr/blog/kiwoom-rest-api-stock-info-ka10001-2026
- 키움 `ka10099` 종목정보 리스트: https://algolab.co.kr/blog/kiwoom-rest-api-stock-list-ka10099-2026

### 마이데이터·데이터 수집

- 마이데이터 참여자별 API 처리 절차(종합포털): https://developers.mydatakorea.org/mdtb/apg/dgi/bas/FSAG0103
- 금융결제원 마이데이터 중계 API(허가 사업자 대상): https://openapi.kftc.or.kr/service/mydata
- CODEF API 개발가이드(데모 키, 토큰 발급): https://developer.codef.io/common-guide
- CODEF: https://codef.io/

### 세법

- 상속세 및 증여세법(국가법령정보센터, 1차 출처): https://www.law.go.kr/법령/상속세및증여세법
- 가족 간 증여세 면제한도(2026년 기준): https://taxfirm.co.kr/blog/gift-tax-exemption-limit-guide
- 증여세 면제 한도와 계산: https://kbthink.com/tax-guide/gift-tax.html
- 2026 증여세 면제한도(10년 합산, 혼인·출산 공제): https://www.make2t.kr/2026/09/2026-gift-tax-exemption-family-guide.html
- 유산취득세 개편안(국회 통과 시 2028 시행): https://www.taxtimes.co.kr/news/article.html?no=268786
- 2026 상속세법 개정안 현황: https://korea-inheritance-gift-tax-simulator.sundry-know.com/blog/2026-inheritance-tax-reform-bill/

### 투자성향

- 키움증권 고객투자성향 및 금융투자상품 분류(5등급, 점수 구간): https://www.kiwoom.com/wm/common/commFundRankInfoPop
- 투자성향분석과 위험등급: https://kbthink.com/fund/investment-profile.html

### 인프라·AI

- Vercel Static IPs: https://vercel.com/docs/networking/static-ips/getting-started
- Gemini 모델 목록(2026-10-13 갱신): https://ai.google.dev/gemini-api/docs/models
- Gemini 3.8 Flash 모델 카드: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- Gemini API 가격·무료 등급과 제품 개선 사용 여부: https://ai.google.dev/gemini-api/docs/pricing
- Gemini API 추가 약관(무료 등급 데이터 사용, 민감정보 금지): https://ai.google.dev/gemini-api/terms
- Interactions API(GA, 저장 기본값과 보관 기간): https://ai.google.dev/gemini-api/docs/interactions
- 구조화 출력: https://ai.google.dev/gemini-api/docs/structured-output
- 함수 호출(상태 없는 다중 턴, 도구 선택): https://ai.google.dev/gemini-api/docs/function-calling
- 사고 수준(thinking_level): https://ai.google.dev/gemini-api/docs/thinking
- 안전 설정과 차단 오류 형식: https://ai.google.dev/gemini-api/docs/safety-settings
- Interactions 상태 값(INCOMPLETE = 출력 한도): https://googleapis.github.io/java-genai/javadoc/com/google/genai/gaos/models/interactions/Interaction.html
- Google Gen AI Python SDK: https://pypi.org/project/google-genai/
- Ollama Python 라이브러리: https://pypi.org/project/ollama/
- Ollama gemma4 모델: https://ollama.com/library/gemma4
- pypdfium2: https://pypi.org/project/pypdfium2/
- (이전 계획) Claude 거절과 폴백: https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
- (이전 계획) Anthropic Python SDK: https://github.com/anthropics/anthropic-sdk-python

