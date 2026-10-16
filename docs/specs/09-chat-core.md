# 09. AI 챗봇 코어: 에이전트 루프, 공급자 어댑터, SSE 스트리밍, 대화 저장, 도구 레지스트리, 채팅 화면

> 웨이브 2 · 브랜치 `feature/09-chat-core` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 01. 모듈 데이터 도구(자산배분·가계부·조건검색 등)는 15에서 이 레지스트리에 등록한다.
> SDK 사용법은 `docs/architecture.md` 9.1·11절과 이 문서 5절의 형태를 따른다. 여기 없는 사용법이 필요하면 추측하지 말고 설치된 `google-genai`·`ollama` 패키지 소스를 확인한 뒤 `ask`로 묻는다.

## 1. 목표

- personal 등급 공급자(기본 로컬 Ollama, 결제가 연결된 키가 있으면 Gemini)와 도구 호출로 동작하는 대화형 에이전트를 백엔드에 만든다. 대화에는 사용자의 자산·가계부·가족 정보가 들어가므로 무료 클라우드로 보내지 않는다(architecture 9.1.1).
- 응답을 SSE로 화면에 보여 주고, 도구 실행 상태와 결과 카드를 함께 보여 준다. Ollama는 글자 단위로 흘리고, Gemini는 라운드 단위로 한 번에 보낸다.
- 대화를 저장하고 이어서 대화할 수 있게 한다. 기록은 추가만 한다(append-only). 대화는 만든 때의 공급자·모델에 묶인다.
- 다른 모듈이 도구를 등록할 수 있는 레지스트리를 만든다. 이번 작업은 기본 도구 2개만 넣는다.

## 2. 범위

### 포함

- `chat_conversations`, `chat_messages`, 대화 CRUD API, 메시지 전송 SSE API
- 공급자 어댑터 2종(Ollama 스트리밍, Gemini 라운드 단위)과 공급자 중립 에이전트 루프(도구 실행, 거절·잘림 처리)
- 도구 레지스트리와 기본 도구 `get_my_profile`, `get_today`
- 사용자별 하루 메시지 상한
- 테스트용 가짜 공급자와 어댑터용 가짜 SDK 클라이언트
- 화면 `/chat`, 모든 앱 화면의 챗봇 위젯(01b 스텁 교체), 카드 렌더러 레지스트리와 기본 카드 3종

### 제외

| 항목 | 처리 |
| --- | --- |
| 모듈 데이터 도구, 전용 결과 카드 | 15 |
| 대화 요약(compaction), 긴 대화 자동 정리 | 범위 밖. 메시지 200개를 넘으면 새 대화를 권한다 |
| 음성·이미지 입력 | 범위 밖 |
| Gemini 글자 단위 스트리밍 | 범위 밖. Interactions 스트리밍의 도구 인자 조각 형식이 공식 문서와 SDK 2.31 사이에 달라서 라운드 단위로만 받는다 |
| 공급자 사이 대화 옮기기 | 범위 밖. 설정이 바뀌면 이전 대화는 읽기만 한다 |

## 3. 소유 파일

- `backend/app/modules/chat/**`(도구 패키지 `chat/tools/**`, 공급자 패키지 `chat/providers/**` 포함)
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
| `provider` | `varchar(10)` | NOT NULL, CHECK `gemini, ollama`. 대화를 만들 때의 personal 공급자 |
| `model` | `varchar(60)` | NOT NULL. 대화를 만들 때의 모델 |
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
| `content` | `jsonb` | NOT NULL. 공급자 원본 항목 배열(5절) |
| `text_preview` | `varchar(500)` | NOT NULL, default `''` |
| `cards` | `jsonb` | NOT NULL, default `[]`. 이 턴에서 만든 카드(최종 응답 행에만) |
| `model` | `varchar(60)` | NULL. 응답한 모델(`response` 행) |
| `stop_reason` | `varchar(20)` | NULL. `end`, `tool_use`, `max_tokens`(`response` 행) |
| `usage` | `jsonb` | NULL. `{"inputTokens", "outputTokens", "cachedInputTokens"}` |
| `created_at` | `timestamptz` | NOT NULL |

- `question`: 사용자 질문(`role=user`). 어댑터의 `user_items(text)` 결과다. Gemini `[{"type": "user_input", "content": [{"type": "text", "text": "..."}]}]`, Ollama `[{"role": "user", "content": "..."}]`. 화면에 보인다.
- `response`: 모델 응답 한 라운드(`role=assistant`). 어댑터가 준 `items`다. 텍스트가 화면에 보인다.
- `tool_results`: 도구 결과(`role=user`). 어댑터의 `tool_result_items(results)` 결과다. 화면에 보이지 않는다.
- **행을 수정하지 않는다.** 다음 요청의 기록(`history`)은 이 행들의 `content`를 `seq` 순서로 이어 붙인 배열이다. Gemini `thought` 단계(서명 포함)도 받은 그대로 다시 보낸다. 예외는 5.4의 두 규칙(응답 없는 질문 빼기, 끊긴 도구 호출에 결과 행 추가)뿐이다.

## 5. 에이전트 루프와 공급자 어댑터

### 5.1 공급자 인터페이스 (`chat/providers/base.py`)

```python
@dataclass(frozen=True)
class ToolCall:
    id: str                    # Gemini는 응답의 id, Ollama는 "call_{라운드 번호}_{순번}"을 만든다
    name: str
    arguments: dict

@dataclass(frozen=True)
class ToolExecResult:
    call: ToolCall
    content: str               # 모델에 보낼 JSON 문자열(json.dumps(ensure_ascii=False, sort_keys=True))
    is_error: bool

@dataclass(frozen=True)
class TextDelta:
    text: str

@dataclass(frozen=True)
class RoundResult:
    stop: Literal["end", "tool_use", "max_tokens", "refused"]
    text: str
    tool_calls: list[ToolCall]
    items: list[dict]          # 저장하고 다시 보낼 공급자 원본 항목(refused면 빈 배열)
    usage: dict                # {"inputTokens", "outputTokens", "cachedInputTokens"}
    model: str

class ProviderUnavailable(Exception):   # 메시지는 화면에 보일 한국어 문장
    ...

class ChatProvider(Protocol):
    name: Literal["gemini", "ollama"]
    model: str
    def user_items(self, text: str) -> list[dict]: ...
    def run_round(self, *, system: str, history: list[dict], tools: list[ToolSpec],
                  effort: Effort, max_tokens: int) -> Iterator[TextDelta | RoundResult]: ...
        # 마지막 값은 항상 RoundResult 하나다
    def tool_result_items(self, results: list[ToolExecResult]) -> list[dict]: ...

def get_chat_provider() -> ChatProvider | None
    # FastAPI 의존성. get_ai_status()의 personal이 꺼져 있으면 None, 켜져 있으면 그 공급자의 어댑터
def display_parts(provider: str, items: list[dict]) -> tuple[str, list[str]]
    # 저장된 항목에서 화면용 텍스트와 도구 이름 목록을 뽑는다(공급자가 바뀐 이전 대화에도 쓴다)
```

- `effort`·`max_tokens`는 작업 등록부 `chat.agent`(medium, 8000)에서 가져온다(`app.integrations.llm.tasks.get_task`).
- 클라이언트는 `app.integrations.llm.clients`의 `get_gemini_client()`·`get_ollama_client()`를 쓴다. 도구 입력 스키마는 `portable_json_schema(input_model)`이다.
- 어댑터는 SDK 예외를 `ProviderUnavailable`로 바꿔 던진다. 문장은 architecture 9.1.4·9.1.5와 같다(예: "로컬 AI(Ollama)에 연결하지 못했습니다. Ollama가 실행 중인지 확인해 주세요."). 원문 예외는 로그에 클래스 이름과 `status_code`만 남긴다.

### 5.2 Gemini 어댑터 (`chat/providers/gemini.py`)

```python
interaction = client.interactions.create(
    model=settings.gemini_model,
    store=False,                                      # 항상 명시
    system_instruction=SYSTEM_PROMPT,
    input=history,                                    # 저장된 항목 + 이번 질문의 user_input
    tools=[{"type": "function", "name": t.name, "description": t.description,
            "parameters": portable_json_schema(t.input_model)} for t in tools],
    generation_config={"thinking_level": effort, "max_output_tokens": max_tokens, "tool_choice": "auto"},
)
```

- 저장 항목 `items` = `[step.model_dump(mode="json", by_alias=True, exclude_none=True) for step in interaction.steps if step.type not in ("user_input", "function_result")]`. 응답에 입력이 다시 실려 와도 중복 저장하지 않는다.
- 텍스트 = `interaction.output_text or ""`. 비어 있지 않으면 `TextDelta` 하나를 먼저 내보낸 뒤 `RoundResult`를 내보낸다.
- 도구 호출 = `function_call` 단계마다 `ToolCall(id=step.id, name=step.name, arguments=step.arguments)`.
- `stop`: `status == "incomplete"`면 `max_tokens`, 아니고 도구 호출이 있으면 `tool_use`, `completed`면 `end`, 그 밖의 상태는 `ProviderUnavailable`. 안전 차단(architecture 9.1.4의 400 + 차단 코드)은 `stop="refused"`, `items=[]`.
- 도구 결과 항목: 결과마다 `{"type": "function_result", "call_id": call.id, "name": call.name, "result": [{"type": "text", "text": content}], "is_error": is_error}`.
- `usage`: `interaction.usage`의 `total_input_tokens`·`total_output_tokens`·`total_cached_tokens`(없으면 0).
- `display_parts`: `model_output` 단계의 `text` 내용을 순서대로 이어 붙이고, `function_call` 단계의 `name`을 모은다.

### 5.3 Ollama 어댑터 (`chat/providers/ollama_provider.py`)

```python
stream = client.chat(
    model=settings.ollama_model,
    messages=[{"role": "system", "content": SYSTEM_PROMPT}, *history],
    tools=[{"type": "function", "function": {"name": t.name, "description": t.description,
            "parameters": portable_json_schema(t.input_model)}} for t in tools],
    stream=True,
    think=(effort != "low") if settings.ollama_thinking else None,
    options={"num_predict": max_tokens, "num_ctx": settings.ollama_num_ctx},
)
for chunk in stream:
    if chunk.message.content:
        yield TextDelta(chunk.message.content)
    if chunk.message.tool_calls:
        calls.extend(chunk.message.tool_calls)
    if chunk.done:
        done_reason = chunk.done_reason
        usage = {"inputTokens": chunk.prompt_eval_count or 0, "outputTokens": chunk.eval_count or 0, "cachedInputTokens": 0}
```

- 사용자 항목: `{"role": "user", "content": question}`.
- 저장 항목: `[{"role": "assistant", "content": <전체 텍스트>, "tool_calls": [{"function": {"name": c.function.name, "arguments": dict(c.function.arguments)}}, ...]}]`. 도구 호출이 없으면 `tool_calls` 키를 뺀다. 사고 내용(`message.thinking`)은 화면에 흘리지도, 저장하지도 않는다.
- 도구 호출 id는 `call_{라운드 번호}_{순번}`으로 만들고 Ollama에는 보내지 않는다.
- `stop`: `done_reason == "length"`면 `max_tokens`, 아니고 도구 호출이 있으면 `tool_use`, 그 밖은 `end`. Ollama는 `refused`를 내지 않는다.
- 도구 결과 항목: 결과마다 `{"role": "tool", "tool_name": call.name, "content": content}`.
- `display_parts`: `assistant` 항목의 `content`를 이어 붙이고 `tool_calls[].function.name`을 모은다.

### 5.4 루프 (`chat/agent.py`)

```python
MAX_TOOL_ROUNDS = 8

def run_turn(ctx, provider, conversation, question_text) -> Iterator[SseEvent]:
    task = get_task("chat.agent")
    history = load_history(conversation, provider)            # 아래 두 규칙을 적용한 뒤 content를 이어 붙임
    question = provider.user_items(question_text)
    save(question)                                            # kind=question
    history += question
    result = None
    for round_no in range(MAX_TOOL_ROUNDS + 1):
        for event in provider.run_round(system=SYSTEM_PROMPT, history=history, tools=get_registered_tools(),
                                        effort=task.effort, max_tokens=task.max_tokens):
            if isinstance(event, TextDelta):
                yield text_delta(event.text)
            else:
                result = event
        if result.stop == "refused":
            yield error("LLM_REFUSED", "이 질문에는 답할 수 없어요. 다른 방식으로 물어봐 주세요."); return
        save(response=result)                                 # kind=response, model, stop_reason, usage
        history += result.items
        if result.stop == "max_tokens":
            yield error("LLM_UNAVAILABLE", "응답이 너무 길어 중단됐어요. 질문을 나눠 주세요."); return
        if result.stop == "end":
            break
        if round_no == MAX_TOOL_ROUNDS:
            yield error("LLM_UNAVAILABLE", "도구 호출이 너무 많아 멈췄어요."); return
        results = []
        for call in result.tool_calls:                        # 순서대로 실행(동시 실행 안 함)
            yield tool_start(call)
            results.append(execute_tool(ctx, call))           # 검증 실패·예외는 is_error 결과
            yield tool_end(call, results[-1])
        items = provider.tool_result_items(results)
        save(tool_results=items)                              # kind=tool_results, 한 행에 모두
        history += items
    save_cards_on_last_response(turn_cards)
    yield message_end(result)
```

- `ProviderUnavailable`은 `error` 이벤트 `LLM_UNAVAILABLE`(예외 메시지)로 바꾼다. 이미 저장한 행은 그대로 둔다.
- 도구 입력은 실행 전에 도구의 Pydantic 입력 모델로 검증한다. 실패하면 `is_error=True`, `content="{\"INVALID_INPUT\": <검증 오류 요약>}"`를 돌려준다.
- 도구 실행 예외는 사용자에게 내부 메시지를 보이지 않는다. 모델에는 `is_error=True`와 `"도구 실행 중 오류가 발생했습니다."`를, 화면에는 `tool_end.ok=false`를 보낸다. 로그에는 예외를 남긴다.
- 클라이언트 연결이 끊기면(제너레이터 종료) 진행 중인 라운드를 버린다. 완성되지 않은 응답은 저장하지 않는다.
- `load_history` 규칙 1: 바로 뒤에 `response` 행이 없는 `question` 행(거절·연결 오류·중단으로 답이 없던 질문)은 기록에서 뺀다. 행은 그대로 둔다.
- `load_history` 규칙 2: 마지막 행이 도구 호출을 가진 `response`인데 뒤에 `tool_results` 행이 없으면(도구 실행 중 끊긴 경우), 각 호출에 `is_error=True`, `content="{\"INTERRUPTED\": \"사용자가 중단했습니다.\"}"`인 결과로 `tool_result_items`를 만들어 `tool_results` 행을 **새로 추가**한 뒤 진행한다. 기존 행은 고치지 않는다.
- 고정 프롬프트: 도구 목록은 이름순, 시스템 프롬프트는 고정 문자열이다. 날짜·사용자 정보 같은 가변 값을 시스템 프롬프트에 넣지 않는다(Gemini 자동 캐시 적중과 테스트 재현성). `usage.cachedInputTokens`를 `message_end`와 DB `usage`에 남긴다.

### 5.5 대화와 공급자 묶음

- 대화를 만들 때(`POST /conversations`, 위젯의 자동 생성 포함) `get_ai_status().personal`이 꺼져 있으면 `503 LLM_UNAVAILABLE`이다. 켜져 있으면 그 `provider`·`model`을 저장한다.
- 메시지를 보낼 때 대화의 `provider`·`model`이 지금 설정과 다르면 `409 CHAT_PROVIDER_CHANGED`("AI 설정이 바뀌어 이 대화는 이어 갈 수 없어요. 새 대화를 시작해 주세요.")다. SSE가 아니라 JSON으로 응답한다.
- 대화 목록·상세는 공급자가 달라도 보여 준다(`display_parts`).

### 5.6 시스템 프롬프트 (`chat/prompts.py`, 고정 문자열)

다음 내용을 담는다(문장은 구현 워커가 다듬되 의미를 바꾸지 않는다).

- 너는 한국어로 답하는 개인 자산관리 학습 도우미다. 사용자는 투자 초보일 수 있으니 쉬운 말로 짧게 답한다. 필요하면 Markdown 목록·표를 쓴다.
- 사용자의 나이, 자산, 가계부, 매매 기록, 가족 정보 같은 개인 데이터는 반드시 도구로 확인한다. 추측하지 않는다.
- 숫자는 도구 결과에 있는 값만 인용하고 단위(원, %)를 붙인다. 오늘 날짜가 필요하면 `get_today`를 쓴다.
- 개별 종목을 사라·팔라고 권하지 않는다. 정보와 일반 원칙을 설명하고 판단은 사용자에게 맡긴다.
- 주문, 이체, 결제는 할 수 없다. 요청받으면 할 수 없다고 말한다.
- 세금 계산은 참고용이며 실제 신고 전에는 세무 전문가와 상담하라고 안내한다.
- 도구로 답할 수 없는 질문이면 그렇다고 말한다. 모르는 것은 모른다고 한다.

### 5.7 하루 상한

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
```

- 공급자별 도구 선언 형식은 어댑터가 만든다(5.2·5.3).
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

- 값은 화면에 그대로 보일 문자열로 만든다(금액은 `app.core.format`으로 서버에서 형식화).
- 프론트 `features/chat/cards/registry.tsx`가 `type`별 컴포넌트를 고른다. 모르는 타입은 무시한다. 15가 타입을 추가한다.

## 8. API 계약 (모두 인증 필요)

| 메서드·경로 | 성공 |
| --- | --- |
| `GET /api/chat/conversations?page=1&pageSize=20` | `200 Page<Conversation>` 최근 대화 순 |
| `POST /api/chat/conversations` | `201 Conversation`(본문 없음 또는 `{"title": "..."}`). personal 공급자가 꺼져 있으면 `503 LLM_UNAVAILABLE` |
| `GET /api/chat/conversations/{id}` | `200 {"conversation": Conversation, "messages": [DisplayMessage...]}` |
| `DELETE /api/chat/conversations/{id}` | `204` |
| `POST /api/chat/conversations/{id}/messages` | `200 text/event-stream` |
| `GET /api/chat/status` | `200 {"enabled": true, "provider": "ollama", "location": "local", "model": "gemma4:12b", "dailyLimit": 100, "usedToday": 3}` |

```json
// Conversation
{ "id": "…", "title": "내 자산배분 점수 알려줘", "provider": "ollama", "model": "gemma4:12b",
  "canContinue": true, "lastMessageAt": "…", "createdAt": "…" }
// DisplayMessage: 턴 단위로 합친 화면용 메시지
{ "id": "…", "turnId": "…", "role": "assistant", "text": "현재 배분 점수는 58점(D)이에요…",
  "toolCalls": [ { "name": "get_my_profile", "label": "프로필 확인 중", "ok": true } ],
  "cards": [ { "type": "key_value", "title": "내 프로필", "items": [ { "label": "나이대", "value": "30대" } ] } ],
  "createdAt": "…" }
```

- `/status`의 `enabled`·`provider`·`location`·`model`은 `get_ai_status().personal`이다.
- `canContinue`: 대화의 `provider`·`model`이 지금 설정과 같고 personal 공급자가 켜져 있으면 `true`.
- `DisplayMessage`: `question` 행은 `role=user`로 하나씩, 한 턴의 `response` 행들은 `role=assistant` 하나로 합친다(`display_parts`로 텍스트를 순서대로 이어 붙이고 도구 이름으로 `toolCalls`, 마지막 응답 행에서 `cards`). `toolCalls.ok`는 같은 턴 `tool_results` 행의 오류 여부다.
- 메시지 전송 요청: `{"content": "내 자산배분 점수 알려줘"}`(공백 제거 후 1~4,000자). 대화 메시지가 200행을 넘으면 `409 CONFLICT`("대화가 길어졌어요. 새 대화를 시작해 주세요."), 공급자 바뀜 `409 CHAT_PROVIDER_CHANGED`, 공급자 꺼짐 `503 LLM_UNAVAILABLE`, 상한 `429`. 이 오류들은 SSE가 아니라 JSON이다.

### 8.1 SSE 이벤트

각 이벤트는 `event: <이름>\ndata: <JSON>\n\n`. 15초마다 `: ping\n\n`. 응답 헤더 `Cache-Control: no-cache`, `X-Accel-Buffering: no`.

| 이벤트 | data |
| --- | --- |
| `message_start` | `{"conversationId", "turnId", "questionMessageId", "provider", "model"}` |
| `text_delta` | `{"text": "현재 "}` |
| `tool_start` | `{"toolUseId", "name", "label"}` |
| `tool_end` | `{"toolUseId", "name", "ok": true, "card": Card \| null}` |
| `message_end` | `{"messageId", "stopReason", "model", "usage": {"inputTokens", "outputTokens", "cachedInputTokens"}}` |
| `error` | `{"code", "message"}` 뒤에 스트림 종료 |

- `toolUseId`는 `ToolCall.id`다.

## 9. 화면 명세

### 9.1 `/chat`

- 왼쪽(모바일은 Sheet): 대화 목록, "새 대화", 삭제(확인). `canContinue=false`인 대화는 "이전 AI 설정" 배지.
- 본문: 메시지 목록(사용자 오른쪽 말풍선, 도우미 왼쪽 Markdown), 받은 글자를 이어 붙인다(Gemini는 라운드가 끝날 때 한 번에 나온다. 그동안 "답을 만드는 중" 표시), 도구 상태 칩(진행 중 스피너 → 성공·실패 아이콘, `label` 표시), 카드(레지스트리 렌더링).
- 상단에 `AiProviderBadge scope="personal"`(01b).
- 입력창: Enter 전송, Shift+Enter 줄바꿈, 전송 중 "멈추기" 버튼(fetch 중단), 남은 하루 횟수. 아래에 처리 위치 문구(로컬: "대화는 이 서버의 로컬 AI로 처리돼요. 답이 조금 느릴 수 있어요.", Gemini: "대화 내용이 Google Gemini로 전송돼요.")와 `Disclaimer variant="ai"`.
- 첫 화면 예시 질문 버튼 4개: "내 나이대에 맞는 자산배분은?", "PER이 뭐야?", "이번 달 지출 요약해줘", "자녀에게 증여하면 세금이 얼마야?"(15 전까지 데이터 도구가 없어도 모델이 할 수 없다고 답한다).
- 공급자 꺼짐(`/status`의 `enabled=false`): 입력창 대신 "AI 상담을 쓰려면 서버에 로컬 AI(Ollama)를 설정하거나, 결제가 연결된 Gemini 키를 설정해야 합니다." 안내.
- `canContinue=false` 대화: 입력창 대신 "AI 설정이 바뀌어 이 대화는 읽기만 할 수 있어요."와 "새 대화" 버튼.

### 9.2 위젯 (`features/chat/components/ChatWidget.tsx`)

- `/chat`을 뺀 모든 앱 화면 오른쪽 아래 둥근 버튼 → 오른쪽 Sheet(모바일은 전체 화면)로 최근 대화를 연다. 최근 대화가 없거나 `canContinue=false`면 새 대화를 연다. 본문은 `/chat`과 같은 컴포넌트, 상단에 "전체 화면으로" 링크.
- 다른 화면이 위젯을 열 수 있게 `features/chat/index.ts`에서 `openChatWidget(options?: { draft?: string })`를 공개한다. `draft`가 있으면 입력창에 그 문장을 채운다(전송은 사용자가 한다). 구현은 위젯이 구독하는 작은 이벤트(`window` CustomEvent `chat:open`)나 전역 store 중 단순한 쪽으로 한다. 16(홈)이 이 함수를 쓴다.

### 9.3 SSE 클라이언트 (`features/chat/sse.ts`)

- `fetch(POST, credentials: "include", signal)` 후 `response.body`를 읽어 이벤트를 파싱한다(`EventSource`는 POST·쿠키 제어가 안 되어 쓰지 않는다). `lib/api-client.ts`의 `API_BASE_URL`을 쓴다.
- 2xx가 아니면 JSON 에러 본문을 `ApiError`로 바꾼다. 줄 경계가 청크 사이에 걸쳐도 올바르게 파싱한다.

## 10. 테스트

### 백엔드 (`backend/tests/chat/`)

- 가짜 공급자(`tests/chat/fakes.py`의 `FakeChatProvider`): 시나리오별 라운드(텍스트 조각, `stop`, `tool_calls`, `items`, `usage`)를 돌려주고 받은 인자(`system`, `history`, `tools`, `effort`, `max_tokens`)를 기록한다. 의존성 `get_chat_provider`로 바꿔 끼운다.
- 루프 시나리오: 텍스트만, 도구 1회 후 답, 한 라운드에 도구 2개, 입력 검증 실패 → `is_error`, 도구 예외 → `ok=false`, `refused`, `max_tokens`, 9라운드 초과, `ProviderUnavailable`, 응답 없는 질문이 다음 기록에서 빠짐(행은 남음), 도구 실행 중 끊김 → 결과 행 추가
- 두 번째 질문의 `history`가 첫 턴 저장 행 `content`를 이어 붙인 것과 바이트 단위로 같다(append-only, 항목 순서·필드 보존)
- Gemini 어댑터(가짜 클라이언트의 `interactions.create`가 `google.genai.interactions.Interaction.model_validate({...})`를 돌려줌): 호출 인자(`model`, `store=False`, `system_instruction`, `input`, 도구 선언 형식, `generation_config`), `steps` → `items`(`user_input`·`function_result` 제외, `thought`의 `signature` 보존), `function_call` → `ToolCall`, `incomplete` → `max_tokens`, 400 + `code: "safety"` → `refused`, 그 밖의 예외 → `ProviderUnavailable`, 도구 결과 항목 형식, `display_parts`
- Ollama 어댑터(가짜 클라이언트의 `chat`이 `ollama.ChatResponse` 조각을 차례로 돌려줌): 호출 인자(system 첫 메시지, 도구 선언 형식, `stream=True`, effort별 `think`, `options`), 텍스트 조각 → `TextDelta`, 도구 호출 수집과 id 생성, `done_reason == "length"` → `max_tokens`, `ConnectionError` → `ProviderUnavailable`, 저장 항목에 `thinking`이 없음, 도구 결과 항목 형식, `display_parts`
- 도구 목록이 이름순이고 `portable_json_schema` 결과다. 시스템 프롬프트에 날짜 같은 가변 값이 없다(두 번 만들어 바이트 비교)
- SSE 이벤트 순서와 형식, ping 주석(시간 조작)
- 하루 상한 429, 200행 409, 공급자 꺼짐 503(대화 생성·전송), 공급자·모델 바뀜 `409 CHAT_PROVIDER_CHANGED`
- 대화 목록·상세(`DisplayMessage` 합치기, 두 공급자 형식 모두)·삭제, `canContinue`, 다른 사용자 대화 404

### 프론트 (`frontend/tests/chat/`)

- SSE 파서: 청크 경계, 여러 이벤트, ping 무시, 에러 이벤트
- 채팅 화면: 받은 텍스트 표시, 도구 칩 상태 변화, 카드 렌더링, 멈추기, 상한·공급자 꺼짐·읽기 전용 대화 안내, 처리 위치 문구(로컬·Gemini)(MSW로 스트림 응답 흉내)
- 위젯 열기·닫기, `/chat`에서는 위젯 숨김, `canContinue=false`면 새 대화

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 로컬 Ollama(`OLLAMA_MODEL` 모델을 받아 둔 상태)에서 "내 나이대 알려줘"에 `get_my_profile`을 부르고 답한다(수동 확인). 결제가 연결된 Gemini 키가 있으면 같은 확인을 한다. 둘 다 없으면 가짜 공급자 테스트로 대신하고 `## 구현 결과`에 적는다
- [ ] 공급자가 꺼져 있으면 화면이 안내 상태로 바뀌고 오류가 나지 않는다

## 12. 검증 체크리스트

1. 5.2·5.3 호출 인자(모델 설정값, Gemini `store=False`·`system_instruction`·도구 선언·`generation_config`, Ollama system 첫 메시지·도구 선언·`stream`·`think`·`options`)가 테스트로 고정돼 있다. 강제 도구 호출이 없다.
2. 저장 행을 수정하는 코드가 없다(UPDATE는 `chat_conversations`의 제목·시각만).
3. 라운드 결과 처리 순서(`refused` → 저장 → `max_tokens` → `end` → 도구 실행)가 5.4와 같다.
4. 도구 입력 재검증과 `is_error` 처리, 내부 예외 메시지 비노출.
5. SSE 이벤트 이름·필드·순서가 8.1과 같다. JSON 오류 응답 경우가 SSE로 새지 않는다.
6. 6절 레지스트리 시그니처와 7절 카드 형식이 같다(15의 전제).
7. 시스템 프롬프트가 5.6의 의미를 모두 담고 가변 값이 없다.
8. 사용자 격리 404, 하루 상한.
9. 챗봇이 personal 등급 공급자만 쓴다. 결제 조건 없이 Gemini로 가는 경로가 없고, 공급자가 바뀐 대화는 이어 쓸 수 없다.

## 13. 다음 단계 연결점

- 15: 모듈 서비스 함수를 감싼 도구와 전용 카드(자산배분 도넛, 관리 방향, 종목 표, 세금 단계표, 방향 비교 등)를 추가한다.
- 16: 홈에서 위젯을 그대로 쓴다.
