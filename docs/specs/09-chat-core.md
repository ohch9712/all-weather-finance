# 09. AI 챗봇 코어: 에이전트 루프, SSE 스트리밍, 대화 저장, 도구 레지스트리, 채팅 화면

> 웨이브 2 · 브랜치 `feature/09-chat-core` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 01. 모듈 데이터 도구(자산배분·가계부·조건검색 등)는 15에서 이 레지스트리에 등록한다.
> 구현 워커는 시작 전에 claude-api 스킬(Python)을 읽는다. 이 문서와 스킬이 다르면 스킬의 SDK 사용법을 따르고 `## 구현 결과`에 적는다.

## 1. 목표

- Claude(`ANTHROPIC_MODEL`, 기본 `claude-opus-5-5`)와 도구 호출로 동작하는 대화형 에이전트를 백엔드에 만든다.
- 응답을 SSE로 흘려 화면에 실시간으로 보여 주고, 도구 실행 상태와 결과 카드를 함께 보여 준다.
- 대화를 저장하고 이어서 대화할 수 있게 한다. 기록은 추가만 한다(append-only).
- 다른 모듈이 도구를 등록할 수 있는 레지스트리를 만든다. 이번 작업은 기본 도구 2개만 넣는다.

## 2. 범위

### 포함

- `chat_conversations`, `chat_messages`, 대화 CRUD API, 메시지 전송 SSE API
- 에이전트 루프(스트리밍, 도구 실행, 거절·잘림 처리, 서버 측 폴백, 프롬프트 캐싱)
- 도구 레지스트리와 기본 도구 `get_my_profile`, `get_today`
- 사용자별 하루 메시지 상한
- 테스트용 가짜 Anthropic 스트림 클라이언트
- 화면 `/chat`, 모든 앱 화면의 챗봇 위젯(01b 스텁 교체), 카드 렌더러 레지스트리와 기본 카드 3종

### 제외

| 항목 | 처리 |
| --- | --- |
| 모듈 데이터 도구, 전용 결과 카드 | 15 |
| 대화 요약(compaction), 긴 대화 자동 정리 | 범위 밖. 메시지 200개를 넘으면 새 대화를 권한다 |
| 음성·이미지 입력 | 범위 밖 |

## 3. 소유 파일

- `backend/app/modules/chat/**`(도구 패키지 `chat/tools/**` 포함)
- `backend/alembic/versions/chat_0001_*.py`
- `backend/tests/chat/**`
- `frontend/src/app/(app)/chat/**`(자리표시 교체)
- `frontend/src/features/chat/**`(01b의 `ChatWidget.tsx` 스텁 교체 포함)
- `frontend/tests/chat/**`
- 이 문서의 `## 구현 결과`

## 4. DB 스키마 (revision `chat_0001`, `branch_labels=("chat",)`)

### 4.1 `chat_conversations`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `title` | `varchar(100)` | NOT NULL, default `'새 대화'`. 첫 질문 앞 30자로 채운다 |
| `last_message_at` | `timestamptz` | NULL |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

인덱스 `(user_id, last_message_at desc)`.

### 4.2 `chat_messages`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `conversation_id` | `uuid` | NOT NULL, FK `chat_conversations.id` ON DELETE CASCADE |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE(하루 상한 계산용) |
| `seq` | `integer` | NOT NULL. 대화 안에서 0부터 증가, UNIQUE `(conversation_id, seq)` |
| `turn_id` | `uuid` | NOT NULL. 사용자 질문 하나에서 시작된 행들의 묶음 |
| `role` | `varchar(10)` | NOT NULL, CHECK `user, assistant` |
| `kind` | `varchar(12)` | NOT NULL, CHECK `question, response, tool_results` |
| `content` | `jsonb` | NOT NULL. API에 보낸·받은 content 블록 배열 원본 |
| `text_preview` | `varchar(500)` | NOT NULL, default `''` |
| `cards` | `jsonb` | NOT NULL, default `[]`. 이 턴에서 만든 카드(최종 응답 행에만) |
| `model` | `varchar(60)` | NULL. 실제 응답한 모델(폴백이면 바뀐다) |
| `stop_reason` | `varchar(20)` | NULL |
| `usage` | `jsonb` | NULL |
| `created_at` | `timestamptz` | NOT NULL |

- `question`: 사용자 질문(`role=user`, `[{"type": "text", "text": "..."}]`). 화면에 보인다.
- `response`: 모델 응답 한 번(`role=assistant`, `final_message.content`의 각 블록 `model_dump(mode="json", exclude_none=True)`). 텍스트 블록이 화면에 보인다.
- `tool_results`: 도구 결과(`role=user`, `tool_result` 블록 배열). 화면에 보이지 않는다.
- **행을 수정하지 않는다.** 다음 요청의 `messages`는 이 행들을 `seq` 순서대로 `{"role", "content"}`로 바꾼 것이다. thinking·fallback 블록도 받은 그대로 다시 보낸다(Opus 5.5는 thinking 블록이 대화에 묶여 있어 기록을 고치면 400이 날 수 있다).

## 5. 에이전트 루프 (`chat/agent.py`)

```python
FALLBACK_BETA = "server-side-fallback-2026-07-01"   # app.integrations.llm.types에서 import
CHAT_EFFORT = "medium"
MAX_TOOL_ROUNDS = 8

def run_turn(ctx, conversation, question_text) -> Iterator[SseEvent]:
    history = load_history(conversation)                       # 저장된 행 → messages
    history.append({"role": "user", "content": [{"type": "text", "text": question_text}]})
    save(question)                                             # kind=question
    for round_no in range(MAX_TOOL_ROUNDS + 1):
        with open_stream(history) as stream:                   # 아래 호출 형태
            for event in stream:
                if event.type == "text":
                    yield text_delta(event.text)
            final = stream.get_final_message()
        save(response=final)                                   # kind=response, model=final.model
        history.append({"role": "assistant", "content": dumped(final.content)})
        if final.stop_reason == "refusal":
            yield error("LLM_REFUSED", "이 질문에는 답할 수 없어요. 다른 방식으로 물어봐 주세요."); return
        tool_uses = [b for b in final.content if b.type == "tool_use"]
        if not tool_uses:
            break                                              # end_turn 등
        if final.stop_reason == "max_tokens":
            yield error("LLM_UNAVAILABLE", "응답이 너무 길어 중단됐어요. 질문을 나눠 주세요."); return
        if round_no == MAX_TOOL_ROUNDS:
            yield error("LLM_UNAVAILABLE", "도구 호출이 너무 많아 멈췄어요."); return
        results = []
        for block in tool_uses:                                # 순서대로 실행(동시 실행 안 함)
            yield tool_start(block)
            results.append(execute_tool(ctx, block))           # 검증 실패·예외는 is_error 결과
            yield tool_end(block, results[-1])
        save(tool_results=results)                             # kind=tool_results, 한 행에 모두
        history.append({"role": "user", "content": [r.block for r in results]})
    save_cards_on_last_response(turn_cards)
    yield message_end(final)
```

`open_stream` 호출 형태(폴백 켜짐일 때)

```python
client.beta.messages.stream(
    model=settings.anthropic_model,
    max_tokens=16000,
    system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
    tools=tool_definitions(),            # 이름순 고정, 각 도구 strict=True, eager_input_streaming=True
    messages=history,
    output_config={"effort": CHAT_EFFORT},
    betas=[FALLBACK_BETA],
    fallbacks="default",
)
```

- 폴백이 꺼져 있으면 `client.messages.stream(...)`(같은 인자에서 `betas`·`fallbacks` 제외).
- `thinking`은 보내지 않는다(Opus 5.5는 항상 적응형). 강제 `tool_choice`는 쓰지 않는다.
- 도구 입력은 eager 스트리밍이라 서버가 검증하지 않는다. 실행 전에 도구의 Pydantic 입력 모델로 검증하고, 실패하면 `{"type": "tool_result", "tool_use_id": id, "is_error": true, "content": "{\"INVALID_INPUT\": ...}"}`를 돌려준다. SDK가 JSON을 아예 못 읽어 스트림에서 `ValueError`가 나면 같은 라운드를 최대 2번 다시 시도한다.
- 도구 실행 예외는 사용자에게 내부 메시지를 보이지 않는다. 모델에는 `is_error: true`와 "도구 실행 중 오류가 발생했습니다." 결과를, 화면에는 `tool_end.ok=false`를 보낸다. 로그에는 예외를 남긴다.
- SDK 예외(`anthropic.APIConnectionError`, `RateLimitError`, `APIStatusError`)는 `error` 이벤트 `LLM_UNAVAILABLE`로 바꾼다. 이미 저장한 행은 그대로 둔다.
- 클라이언트 연결이 끊기면(제너레이터 종료) 스트림을 닫고, 완성되지 않은 응답은 저장하지 않고 버린다. 그 턴은 질문 행(또는 이미 저장된 행)까지만 남는다. 새 질문이 바로 뒤에 붙어도 API는 연속된 user 메시지를 합쳐 처리한다.
- `load_history`는 마지막 행이 `tool_use` 블록을 가진 `response`인데 뒤에 `tool_results` 행이 없으면(도구 실행 중 끊긴 경우), 각 `tool_use`에 `{"type": "tool_result", "tool_use_id": id, "is_error": true, "content": "사용자가 중단했습니다."}`를 담은 `tool_results` 행을 **새로 추가**한 뒤 진행한다. 기존 행은 고치지 않는다. 이 경우를 테스트한다.
- 프롬프트 캐싱: `tools`(이름순) → `system`(고정 문자열) 순서가 매번 같아야 한다. 날짜·사용자 정보·도구 목록 변화 같은 가변 값을 시스템 프롬프트에 넣지 않는다. `usage.cache_read_input_tokens`를 `message_end`와 DB `usage`에 남긴다.

### 5.1 시스템 프롬프트 (`chat/prompts.py`, 고정 문자열)

다음 내용을 담는다(문장은 구현 워커가 다듬되 의미를 바꾸지 않는다).

- 너는 한국어로 답하는 개인 자산관리 학습 도우미다. 사용자는 투자 초보일 수 있으니 쉬운 말로 짧게 답한다. 필요하면 Markdown 목록·표를 쓴다.
- 사용자의 나이, 자산, 가계부, 매매 기록, 가족 정보 같은 개인 데이터는 반드시 도구로 확인한다. 추측하지 않는다.
- 숫자는 도구 결과에 있는 값만 인용하고 단위(원, %)를 붙인다. 오늘 날짜가 필요하면 `get_today`를 쓴다.
- 개별 종목을 사라·팔라고 권하지 않는다. 정보와 일반 원칙을 설명하고 판단은 사용자에게 맡긴다.
- 주문, 이체, 결제는 할 수 없다. 요청받으면 할 수 없다고 말한다.
- 세금 계산은 참고용이며 실제 신고 전에는 세무 전문가와 상담하라고 안내한다.
- 도구로 답할 수 없는 질문이면 그렇다고 말한다. 모르는 것은 모른다고 한다.

### 5.2 하루 상한

- 오늘(KST) 사용자가 보낸 `question` 행 수가 `CHAT_DAILY_MESSAGE_LIMIT` 이상이면 `429 CHAT_LIMIT_EXCEEDED`("오늘 대화 한도를 다 썼어요. 내일 다시 이용해 주세요."). SSE를 열기 전에 JSON으로 응답한다.

## 6. 도구 레지스트리 (`chat/tools/registry.py`)

```python
@dataclass
class ToolContext:
    db: Session
    user: User
    today: date                      # today_kst()

@dataclass
class ToolOutput:
    content: str | dict | list       # 모델에 보낼 결과. dict·list는 json.dumps(ensure_ascii=False, sort_keys=True)
    card: dict | None = None         # 화면 카드(7절 형식)

@dataclass(frozen=True)
class ToolSpec:
    name: str                        # snake_case, 바꾸지 않는다
    description: str                 # 모델용 한국어 설명: 언제 쓰는지, 무엇을 돌려주는지
    input_model: type[BaseModel]     # model_config = ConfigDict(extra="forbid")
    label: str                       # 화면 상태 문구. 예: "자산배분 확인 중"
    handler: Callable[[ToolContext, BaseModel], ToolOutput]

def register_tool(spec: ToolSpec) -> None          # 같은 이름 재등록은 ValueError
def get_registered_tools() -> list[ToolSpec]       # 이름순
def tool_definitions() -> list[dict]               # {"name", "description", "input_schema": strict_json_schema(input_model), "strict": True, "eager_input_streaming": True}
```

- 도구 모듈은 `chat/tools/__init__.py`가 import해서 등록한다. 15는 도구 파일을 추가하고 이 `__init__.py`에 import 줄을 더한다.
- 도구 결과의 개인 데이터는 필요한 만큼만 담는다(이메일·ID 제외).

기본 도구

| name | 입력 | 결과(content) | 카드 |
| --- | --- | --- | --- |
| `get_today` | `{}` | `{"today": "2026-10-16", "weekday": "금요일", "timezone": "Asia/Seoul"}` | 없음 |
| `get_my_profile` | `{}` | `{"birthYear": 1994, "age": 32, "ageBand": "30s", "ageBandLabel": "30대", "nickname": "감자"}`(01의 `get_profile`) | `key_value` |

## 7. 카드 형식 (프론트·백엔드 공통 계약)

```ts
type Card =
  | { type: "key_value"; title: string; items: { label: string; value: string }[] }
  | { type: "table"; title: string; columns: { key: string; label: string; align?: "left" | "right" }[];
      rows: Record<string, string>[]; footnote?: string }
  | { type: "link"; title: string; description?: string; href: string };   // 앱 내부 경로("/"로 시작)만
```

- 값은 화면에 그대로 보일 문자열로 만든다(금액은 `"1,234,000원"`처럼 서버에서 형식화).
- 프론트 `features/chat/cards/registry.tsx`가 `type`별 컴포넌트를 고른다. 모르는 타입은 무시한다. 15가 타입을 추가한다.

## 8. API 계약 (모두 인증 필요)

| 메서드·경로 | 성공 |
| --- | --- |
| `GET /api/chat/conversations?page=1&pageSize=20` | `200 Page<Conversation>` 최근 대화 순 |
| `POST /api/chat/conversations` | `201 Conversation`(본문 없음 또는 `{"title": "..."}`) |
| `GET /api/chat/conversations/{id}` | `200 {"conversation": Conversation, "messages": [DisplayMessage...]}` |
| `DELETE /api/chat/conversations/{id}` | `204` |
| `POST /api/chat/conversations/{id}/messages` | `200 text/event-stream` |
| `GET /api/chat/status` | `200 {"enabled": true, "dailyLimit": 100, "usedToday": 3}` |

```json
// Conversation
{ "id": "…", "title": "내 자산배분 점수 알려줘", "lastMessageAt": "…", "createdAt": "…" }
// DisplayMessage: 턴 단위로 합친 화면용 메시지
{ "id": "…", "turnId": "…", "role": "assistant", "text": "현재 배분 점수는 80점(A)이에요…",
  "toolCalls": [ { "name": "get_my_profile", "label": "프로필 확인 중", "ok": true } ],
  "cards": [ { "type": "key_value", "title": "내 프로필", "items": [ { "label": "나이대", "value": "30대" } ] } ],
  "createdAt": "…" }
```

- `DisplayMessage`: `question` 행은 `role=user`로 하나씩, 한 턴의 `response` 행들은 `role=assistant` 하나로 합친다(텍스트 블록을 순서대로 이어 붙이고, `tool_use` 블록에서 `toolCalls`, 마지막 응답 행에서 `cards`).
- 메시지 전송 요청: `{"content": "내 자산배분 점수 알려줘"}`(공백 제거 후 1~4,000자). 대화 메시지가 200행을 넘으면 `409 CONFLICT`("대화가 길어졌어요. 새 대화를 시작해 주세요."). LLM 꺼짐 `503 LLM_UNAVAILABLE`, 상한 `429`. 이 오류들은 SSE가 아니라 JSON이다.

### 8.1 SSE 이벤트

각 이벤트는 `event: <이름>\ndata: <JSON>\n\n`. 15초마다 `: ping\n\n`. 응답 헤더 `Cache-Control: no-cache`, `X-Accel-Buffering: no`.

| 이벤트 | data |
| --- | --- |
| `message_start` | `{"conversationId", "turnId", "questionMessageId"}` |
| `text_delta` | `{"text": "현재 "}` |
| `tool_start` | `{"toolUseId", "name", "label"}` |
| `tool_end` | `{"toolUseId", "name", "ok": true, "card": Card \| null}` |
| `message_end` | `{"messageId", "stopReason", "model", "usage": {"inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"}}` |
| `error` | `{"code", "message"}` 뒤에 스트림 종료 |

## 9. 화면 명세

### 9.1 `/chat`

- 왼쪽(모바일은 Sheet): 대화 목록, "새 대화", 삭제(확인).
- 본문: 메시지 목록(사용자 오른쪽 말풍선, 도우미 왼쪽 Markdown), 스트리밍 중 글자가 이어 붙는다, 도구 상태 칩(진행 중 스피너 → 성공·실패 아이콘, `label` 표시), 카드(레지스트리 렌더링).
- 입력창: Enter 전송, Shift+Enter 줄바꿈, 전송 중 "멈추기" 버튼(fetch 중단), 남은 하루 횟수, 아래에 `Disclaimer variant="ai"`.
- 첫 화면 예시 질문 버튼 4개: "내 나이대에 맞는 자산배분은?", "PER이 뭐야?", "이번 달 지출 요약해줘", "자녀에게 증여하면 세금이 얼마야?"(15 전까지 데이터 도구가 없어도 모델이 할 수 없다고 답한다).
- LLM 꺼짐(`/status`의 `enabled=false`): 입력창 대신 "AI 기능을 쓰려면 서버에 Anthropic API 키를 설정해야 합니다." 안내.

### 9.2 위젯 (`features/chat/components/ChatWidget.tsx`)

- `/chat`을 뺀 모든 앱 화면 오른쪽 아래 둥근 버튼 → 오른쪽 Sheet(모바일은 전체 화면)로 최근 대화(없으면 새 대화)를 연다. 본문은 `/chat`과 같은 컴포넌트, 상단에 "전체 화면으로" 링크.
- 다른 화면이 위젯을 열 수 있게 `features/chat/index.ts`에서 `openChatWidget(options?: { draft?: string })`를 공개한다. `draft`가 있으면 입력창에 그 문장을 채운다(전송은 사용자가 한다). 구현은 위젯이 구독하는 작은 이벤트(`window` CustomEvent `chat:open`)나 전역 store 중 단순한 쪽으로 한다. 16(홈)이 이 함수를 쓴다.

### 9.3 SSE 클라이언트 (`features/chat/sse.ts`)

- `fetch(POST, credentials: "include", signal)` 후 `response.body`를 읽어 이벤트를 파싱한다(`EventSource`는 POST·쿠키 제어가 안 되어 쓰지 않는다). `lib/api-client.ts`의 `API_BASE_URL`을 쓴다.
- 2xx가 아니면 JSON 에러 본문을 `ApiError`로 바꾼다. 줄 경계가 청크 사이에 걸쳐도 올바르게 파싱한다.

## 10. 테스트

### 백엔드 (`backend/tests/chat/`)

- 가짜 클라이언트(`chat/testing.py` 또는 `tests/chat/fakes.py`): `beta.messages.stream`과 `messages.stream`을 흉내 낸다. 시나리오별로 이벤트(`text`)와 최종 메시지(content 블록, `stop_reason`, `usage`, `model`)를 돌려주고, 받은 인자(`model`, `system`, `tools`, `messages`, `output_config`, `betas`, `fallbacks`)를 기록한다. 의존성 `get_chat_client`로 바꿔 끼운다.
- 시나리오: 텍스트만, 도구 1회 후 답, 같은 응답에 도구 2개, 입력 검증 실패 → `is_error`, 도구 예외 → `ok=false`, `refusal`, `max_tokens`+tool_use, 9라운드 초과, SDK 예외, 폴백 꺼짐 시 `messages.stream` 사용
- 두 번째 질문의 `messages`가 첫 턴의 저장 행 원본과 바이트 단위로 같다(append-only, 블록 순서·필드 보존)
- `tools`가 이름순이고 `strict`·`eager_input_streaming`이 켜져 있다. `system`에 `cache_control`이 있고 날짜가 없다
- SSE 이벤트 순서와 형식, ping 주석(시간 조작)
- 하루 상한 429, 200행 409, LLM 꺼짐 503
- 대화 목록·상세(`DisplayMessage` 합치기)·삭제, 다른 사용자 대화 404

### 프론트 (`frontend/tests/chat/`)

- SSE 파서: 청크 경계, 여러 이벤트, ping 무시, 에러 이벤트
- 채팅 화면: 스트리밍 텍스트 표시, 도구 칩 상태 변화, 카드 렌더링, 멈추기, 상한·LLM 꺼짐 안내(MSW로 스트림 응답 흉내)
- 위젯 열기·닫기, `/chat`에서는 위젯 숨김

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] `LLM_MODE=anthropic`과 실제 키가 있는 환경에서 "내 나이대 알려줘"에 `get_my_profile`을 부르고 답한다(수동 확인, 키가 없으면 가짜 클라이언트 테스트로 대신하고 `## 구현 결과`에 적는다)
- [ ] 키가 없으면 화면이 안내 상태로 바뀌고 오류가 나지 않는다

## 12. 검증 체크리스트

1. 5절 호출 인자(모델 설정값, `max_tokens`, `system`+`cache_control`, 이름순 strict 도구, `output_config.effort`, 폴백 beta·`fallbacks="default"`)가 테스트로 고정돼 있다. `thinking`·강제 `tool_choice`가 없다.
2. 저장 행을 수정하는 코드가 없다(UPDATE는 `chat_conversations`의 제목·시각만).
3. `stop_reason` 확인 순서(refusal → tool_use 유무 → max_tokens)가 5절과 같다.
4. 도구 입력 재검증과 `is_error` 처리, 내부 예외 메시지 비노출.
5. SSE 이벤트 이름·필드·순서가 8.1과 같다. JSON 오류 응답 경우가 SSE로 새지 않는다.
6. 6절 레지스트리 시그니처와 7절 카드 형식이 같다(15의 전제).
7. 시스템 프롬프트가 5.1의 의미를 모두 담고 가변 값이 없다.
8. 사용자 격리 404, 하루 상한.

## 13. 다음 단계 연결점

- 15: 모듈 서비스 함수를 감싼 도구와 전용 카드(자산배분 도넛, 종목 표, 세금 단계표 등)를 추가한다.
- 16: 홈에서 위젯을 그대로 쓴다.
