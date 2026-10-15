# 07. 학습 게시판: 주린이용 글·영상·용어 사전

> 웨이브 2 · 브랜치 `feature/07-learn` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 01.

## 1. 목표

- 주식 입문자를 위한 쉬운 글, YouTube 영상, 용어 사전을 한곳에 모은다.
- 관리자가 글·영상·용어를 작성·공개하고, AI 초안 도움을 받을 수 있다.
- 사용자는 검색·필터·북마크·읽음 표시로 학습 진도를 확인한다.
- 챗봇(15)이 용어 설명의 근거로 이 게시판을 검색할 수 있게 서비스 함수를 제공한다.

## 2. 범위

### 포함

- 게시물(글 `article`, 영상 `video`, 용어 `glossary`) 조회·검색·필터, 상세
- 북마크, 읽음 표시, 학습 진도, 오늘의 용어, 초성 색인 용어 사전
- 관리자 CRUD·공개 전환, AI 초안
- 시드 콘텐츠(용어 30개, 입문 글 5개) 명령
- 화면 `/learn`, `/learn/[slug]`, `/learn/glossary`, `/admin/learn`(+ 작성·수정)

### 제외

| 항목 | 처리 |
| --- | --- |
| 사용자 글쓰기·댓글·좋아요 | 범위 밖 |
| 영상 업로드·호스팅 | YouTube 링크 임베드만 |
| 영상 시드 | 실제 URL을 지어낼 수 없으므로 시드하지 않는다. 관리자가 등록한다 |

## 3. 소유 파일

- `backend/app/modules/learn/**`(시드 데이터 `learn/seed_data/**` 포함)
- `backend/alembic/versions/learn_0001_*.py`
- `backend/tests/learn/**`
- `frontend/src/app/(app)/learn/**`, `frontend/src/app/(app)/admin/learn/**`(자리표시 교체·신규)
- `frontend/src/features/learn/**`
- `frontend/tests/learn/**`
- 이 문서의 `## 구현 결과`

## 4. DB 스키마 (revision `learn_0001`, `branch_labels=("learn",)`)

### 4.1 `posts`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `kind` | `varchar(10)` | NOT NULL, CHECK `article, video, glossary` |
| `slug` | `varchar(80)` | NOT NULL, UNIQUE. 영문 소문자·숫자·하이픈 |
| `title` | `varchar(100)` | NOT NULL |
| `summary` | `varchar(200)` | NOT NULL. 목록·용어 한 줄 정의 |
| `body_md` | `text` | NOT NULL, default `''`, 2만 자 이하 |
| `term` | `varchar(50)` | 용어일 때 필수. 용어끼리 UNIQUE(부분 인덱스) |
| `video_url` | `text` | 영상일 때 필수 |
| `video_id` | `varchar(20)` | 영상일 때 URL에서 추출 |
| `level` | `varchar(12)` | NOT NULL, CHECK `beginner, basic, intermediate` |
| `tags` | `varchar(20)[]` | NOT NULL, default `{}`, 최대 10개 |
| `published` | `boolean` | NOT NULL, default false |
| `published_at` | `timestamptz` | NULL. 처음 공개할 때 채움 |
| `ai_assisted` | `boolean` | NOT NULL, default false |
| `author_id` | `uuid` | NULL, FK users ON DELETE SET NULL(시드는 null) |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

인덱스 `(kind, published, published_at desc)`.

### 4.2 `bookmarks`, `post_reads`

| 테이블 | 컬럼 |
| --- | --- |
| `bookmarks` | `user_id`(FK users CASCADE), `post_id`(FK posts CASCADE), `created_at`, PK `(user_id, post_id)` |
| `post_reads` | `user_id`(FK users CASCADE), `post_id`(FK posts CASCADE), `read_at`, PK `(user_id, post_id)` |

## 5. 규칙

- 영상 URL은 `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `m.youtube.com` 형식만 받는다. `video_id`(영문·숫자·`-`·`_`, 11자)를 뽑고, 화면은 `https://www.youtube-nocookie.com/embed/<video_id>`로 임베드한다. 다른 호스트는 `422`(`field: "videoUrl"`, "YouTube 링크만 등록할 수 있습니다.").
- 본문은 Markdown이다. 프론트는 `react-markdown` + `remark-gfm`으로만 그리고 원시 HTML은 렌더링하지 않는다.
- 초성: 한글 음절은 첫 자음(쌍자음은 기본 자음으로: ㄲ→ㄱ, ㄸ→ㄷ, ㅃ→ㅂ, ㅆ→ㅅ, ㅉ→ㅈ), 영문은 `A-Z`, 그 밖은 `#`.
- 오늘의 용어: 공개된 용어를 `slug` 순으로 정렬하고 `날짜.toordinal() % 개수` 번째. 용어가 없으면 null.
- 검색 `q`: `title`, `term`, `summary`, `body_md` 부분 일치(대소문자 무시). 정렬은 제목·용어 일치 → 공개일 최신 순.

## 6. API 계약

### 6.1 사용자용 (인증 필요, 공개 게시물만)

| 메서드·경로 | 성공 |
| --- | --- |
| `GET /api/learn/posts?kind=&level=&tag=&q=&bookmarked=false&page=1&pageSize=12` | `200 Page<PostSummary>` |
| `GET /api/learn/posts/{slug}` | `200 PostDetail`, 비공개·없음 `404` |
| `POST /api/learn/posts/{id}/bookmark` | `204`(이미 있으면 그대로) |
| `DELETE /api/learn/posts/{id}/bookmark` | `204` |
| `POST /api/learn/posts/{id}/read` | `204`(upsert) |
| `GET /api/learn/glossary?q=&initial=` | `200 {"items": [GlossaryItem...]}` 용어 가나다순 |
| `GET /api/learn/today` | `200 {"post": PostSummary \| null}` |
| `GET /api/learn/progress` | `200 {"readCount": 12, "publishedCount": 35, "byKind": {"article": {"read": 2, "published": 5}, "video": {...}, "glossary": {...}}}` |

```json
// PostSummary
{ "id": "…", "kind": "glossary", "slug": "per", "title": "PER(주가수익비율)", "summary": "주가가 1주당 순이익의 몇 배인지 나타내는 지표",
  "term": "PER", "level": "beginner", "tags": ["지표", "가치평가"], "videoId": null, "aiAssisted": false,
  "publishedAt": "2026-10-16T00:00:00Z", "bookmarked": true, "read": false }
// PostDetail = PostSummary + bodyMd, videoUrl, related: PostSummary[] (태그가 겹치는 공개 게시물 최대 3개)
// GlossaryItem = { "id", "slug", "term", "summary", "initial": "ㅂ", "read": false }
```

### 6.2 관리자용 (`AdminUser`, 아니면 `403 FORBIDDEN`)

| 메서드·경로 | 성공 |
| --- | --- |
| `GET /api/learn/admin/posts?published=&kind=&q=&page=` | `200 Page<AdminPost>`(비공개 포함) |
| `POST /api/learn/admin/posts` | `201 AdminPost` |
| `GET /api/learn/admin/posts/{id}` | `200 AdminPost` |
| `PATCH /api/learn/admin/posts/{id}` | `200 AdminPost` |
| `DELETE /api/learn/admin/posts/{id}` | `204` |
| `POST /api/learn/admin/ai-draft` | `200 Draft` |

- `AdminPost`: 4.1 컬럼 camelCase 전부.
- 입력 검증: `slug` 비면 `p-<8자리 hex>` 자동, 형식 위반·중복은 `422`/`409 CONFLICT`. `term`은 용어일 때 필수·용어끼리 중복 409. `videoUrl`은 영상일 때 필수(5절).
- AI 초안 요청: `{"kind": "glossary", "topic": "PBR", "level": "beginner"}` → `llm.generate(task="learn.ai_draft", system=…, content=…, output=DraftOutput, effort="medium", max_tokens=8000)` → `Draft {"title", "summary", "term", "bodyMd", "tags"}`. 저장하지 않는다. 화면이 폼에 채우고 `aiAssisted=true`로 저장한다. 시스템 프롬프트: 입문자용 쉬운 한국어, 비유와 예시 하나, 투자 권유 금지, 시점에 따라 바뀌는 수치(세법 한도·금리)는 넣지 않거나 기준 시점을 밝힘, Markdown 소제목 2~4개.

## 7. 시드 콘텐츠

`uv run python -m app.modules.learn.seed`: `learn/seed_data/*.md`(앞머리 YAML: kind, slug, title, summary, term, level, tags)를 읽어 `slug` 기준 upsert하고 공개한다. 여러 번 실행해도 같다.

- 용어 30개(slug): 주식 `stock`, 채권 `bond`, ETF `etf`, 인덱스 펀드 `index-fund`, 배당 `dividend`, 배당수익률 `dividend-yield`, 시가총액 `market-cap`, PER `per`, PBR `pbr`, ROE `roe`, EPS `eps`, 예수금 `deposit`, 호가 `quote`, 시장가 주문 `market-order`, 지정가 주문 `limit-order`, 상한가·하한가 `price-limit`, 코스피 `kospi`, 코스닥 `kosdaq`, 분산투자 `diversification`, 자산배분 `asset-allocation`, 리밸런싱 `rebalancing`, 복리 `compound-interest`, 인플레이션 `inflation`, 기준금리 `base-rate`, 환율 `exchange-rate`, 손절매 `stop-loss`, 물타기 `averaging-down`, 레버리지 ETF `leveraged-etf`, ISA `isa`, 연금저축 `pension-savings`
- 입문 글 5개: "주식 계좌를 만들기 전에 알아둘 것" `before-first-account`, "나이에 따라 자산배분이 달라지는 이유" `why-age-based-allocation`, "ETF로 시작하는 분산투자" `start-with-etf`, "PER·PBR로 종목을 비교하는 법" `compare-with-per-pbr`, "매매일지를 써야 하는 이유" `why-trading-journal`
- 작성 기준: 초등 고학년도 이해할 문장, 비유 하나와 숫자 예시 하나, 투자 권유 금지, 바뀌는 수치(ISA·연금저축 한도, 세율, 금리)는 쓰지 않는다. 일반 개념만 쓴다. 검증 워커가 사실 여부를 확인한다.

## 8. 다른 모듈용 서비스 함수

```python
# app/modules/learn/service.py
def search_posts(db, query: str, *, kind: str | None = None, limit: int = 5) -> list[PostSummary]   # 공개만, bookmarked/read는 False
def get_term_of_the_day(db, day: date) -> PostSummary | None
def get_progress(db, user_id) -> LearnProgress      # 6.1 `/progress` 응답과 같은 필드
```

## 9. 화면 명세

- `/learn`: 제목 "주린이 학습", 진도 막대(`progress`), 오늘의 용어 카드, 종류 탭(전체·글·영상·용어), 난이도 칩(입문·기초·중급), 태그 선택, 검색, "북마크만" 토글, 카드 그리드(종류 아이콘, 제목, 요약, 난이도, 읽음 체크, 북마크 버튼). 필터는 URL 쿼리에 반영.
- `/learn/[slug]`: 글은 Markdown 본문, 영상은 16:9 임베드 + 설명, 용어는 큰 용어명·한 줄 정의·본문. 공통으로 태그, 북마크, 관련 게시물, "AI 도움으로 작성" 배지(`aiAssisted`). 진입 시 읽음 표시.
- `/learn/glossary`: 초성 색인 바(ㄱ~ㅎ, A-Z, #), 용어 목록(용어·한 줄 정의·읽음), 검색.
- `/admin/learn`: 관리자만(일반 사용자는 "권한이 없습니다" 화면). 게시물 표(종류, 제목, 공개 여부 스위치, 수정일), 새로 만들기, 수정, 삭제 확인.
- `/admin/learn/new`, `/admin/learn/[id]/edit`: 폼(종류에 따라 용어·영상 URL 칸 표시), Markdown 작성·미리보기 탭, "AI 초안 만들기"(주제·난이도 → 폼 채움, LLM 꺼짐이면 안내).

## 10. 테스트

### 백엔드 (`backend/tests/learn/`)

- 시드 명령 멱등성(두 번 실행해도 35개), 모든 시드가 공개 상태
- 목록 필터·검색·정렬·페이지네이션, 비공개 숨김, `bookmarked`·`read` 플래그
- 북마크·읽음 멱등성, 진도 집계
- 초성 계산(쌍자음, 영문, 숫자), 오늘의 용어(날짜에 따라 결정적)
- YouTube URL 형식 4종과 거부 사례
- 관리자: 403/200, 슬러그 자동·중복 409, 용어 중복 409, AI 초안(`FakeStructuredLLM`, task 이름·effort 확인), LLM 꺼짐 503
- `search_posts` 결과

### 프론트 (`frontend/tests/learn/`, MSW)

- 목록 필터·URL 반영, 북마크 토글, 상세 3종 렌더링(Markdown 원시 HTML이 렌더링되지 않음), 용어 사전 초성 이동
- 관리자 폼(종류별 필드), AI 초안 채우기, 일반 사용자 접근 차단 화면

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 시드 후 `/learn`에서 용어 30개와 글 5개가 보이고 상세가 열린다
- [ ] 관리자로 영상 게시물을 만들면 임베드가 재생된다(youtube-nocookie)

## 12. 검증 체크리스트

1. 시드 35개의 slug가 7절 목록과 같고, 내용에 투자 권유나 틀린 사실, 바뀌는 수치가 없다(표본이 아니라 전부 읽는다).
2. 6절 경로·필드·상태코드, 관리자 403이 같다.
3. Markdown 렌더링에서 원시 HTML·스크립트가 실행되지 않는다.
4. YouTube 외 URL 거부, nocookie 도메인 임베드.
5. `search_posts`, `get_term_of_the_day`, `get_progress` 시그니처가 8절과 같다.
6. 북마크·읽음은 다른 사용자에게 보이지 않는다.

## 13. 다음 단계 연결점

- 15: `search_posts`로 용어 설명 도구를 만든다.
- 16: 홈에 오늘의 용어와 학습 진도를 보여 준다(`get_term_of_the_day`, `get_progress`).
