import { HttpResponse, http } from "msw";
import type { ChatStatus, Conversation, ConversationDetail, DisplayMessage } from "@/features/chat/types";
import { apiUrl, errorResponse, server } from "../utils";

// 챗봇 API 가짜 응답(MSW). SSE 응답은 테스트가 조각을 직접 흘려 보낸다.

export const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
export const TURN_ID = "22222222-2222-4222-8222-222222222222";

export function chatStatus(overrides: Partial<ChatStatus> = {}): ChatStatus {
  return {
    enabled: true,
    provider: "ollama",
    location: "local",
    model: "gemma4:12b",
    dailyLimit: 100,
    usedToday: 3,
    ...overrides,
  };
}

export function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONVERSATION_ID,
    title: "내 나이대 알려줘",
    provider: "ollama",
    model: "gemma4:12b",
    canContinue: true,
    lastMessageAt: "2026-10-16T03:21:45Z",
    createdAt: "2026-10-16T03:20:00Z",
    ...overrides,
  };
}

export function displayMessages(): DisplayMessage[] {
  return [
    {
      id: "33333333-3333-4333-8333-333333333333",
      turnId: TURN_ID,
      role: "user",
      text: "지난 질문",
      toolCalls: [],
      cards: [],
      createdAt: "2026-10-16T03:21:00Z",
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      turnId: TURN_ID,
      role: "assistant",
      text: "지난 **답변**",
      toolCalls: [{ name: "get_my_profile", label: "프로필 확인 중", ok: true }],
      cards: [{ type: "key_value", title: "내 프로필", items: [{ label: "나이대", value: "30대" }] } as never],
      createdAt: "2026-10-16T03:21:45Z",
    },
  ];
}

export function aiStatus(location: "local" | "cloud" | null = "local") {
  const enabled = location !== null;
  return {
    general: { enabled: false, provider: null, location: null, model: null, reason: "not_configured" },
    personal: {
      enabled,
      provider: location === "cloud" ? "gemini" : enabled ? "ollama" : null,
      location,
      model: enabled ? "gemma4:12b" : null,
      reason: enabled ? null : "not_configured",
    },
  };
}

/** 조각을 직접 흘리는 SSE 본문 */
export function sseStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: () => new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } }),
    push(text: string) {
      controller.enqueue(encoder.encode(text));
    },
    event(name: string, data: unknown) {
      controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    close() {
      controller.close();
    },
  };
}

export const messageStart = {
  conversationId: CONVERSATION_ID,
  turnId: "55555555-5555-4555-8555-555555555555",
  questionMessageId: "66666666-6666-4666-8666-666666666666",
  provider: "ollama",
  model: "gemma4:12b",
};

export const messageEnd = {
  messageId: "77777777-7777-4777-8777-777777777777",
  stopReason: "end",
  model: "gemma4:12b",
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
};

interface FakeChatOptions {
  status?: ChatStatus;
  location?: "local" | "cloud" | null;
  conversations?: Conversation[];
  details?: Record<string, ConversationDetail>;
  /** 메시지 전송 응답. 없으면 501 */
  onSend?: (id: string, body: { content: string }) => Response | Promise<Response>;
}

/** 챗봇 API 가짜 서버. 받은 요청을 기록한다. */
export function mockChatApi(options: FakeChatOptions = {}) {
  const calls = { created: 0, sent: [] as { id: string; content: string }[], detail: [] as string[], deleted: [] as string[] };
  let conversations = options.conversations ?? [];
  const details = { ...(options.details ?? {}) };
  server.use(
    http.get(apiUrl("/api/ai/status"), () => HttpResponse.json(aiStatus(options.location ?? "local"))),
    http.get(apiUrl("/api/chat/status"), () => HttpResponse.json(options.status ?? chatStatus())),
    http.get(apiUrl("/api/chat/conversations"), ({ request }) => {
      const url = new URL(request.url);
      const page = Number(url.searchParams.get("page") ?? 1);
      const pageSize = Number(url.searchParams.get("pageSize") ?? 20);
      const items = conversations.slice((page - 1) * pageSize, page * pageSize);
      return HttpResponse.json({ items, page, pageSize, total: conversations.length });
    }),
    http.post(apiUrl("/api/chat/conversations"), () => {
      calls.created += 1;
      const created = conversation({ title: "새 대화", lastMessageAt: null });
      conversations = [created, ...conversations];
      details[created.id] ??= { conversation: created, messages: [] };
      return HttpResponse.json(created, { status: 201 });
    }),
    http.get(apiUrl("/api/chat/conversations/:id"), ({ params }) => {
      const id = String(params.id);
      calls.detail.push(id);
      const detail = details[id];
      return detail ? HttpResponse.json(detail) : errorResponse(404, "NOT_FOUND", "대화를 찾을 수 없습니다.");
    }),
    http.delete(apiUrl("/api/chat/conversations/:id"), ({ params }) => {
      calls.deleted.push(String(params.id));
      conversations = conversations.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(apiUrl("/api/chat/conversations/:id/messages"), async ({ params, request }) => {
      const body = (await request.json()) as { content: string };
      calls.sent.push({ id: String(params.id), content: body.content });
      return options.onSend ? options.onSend(String(params.id), body) : errorResponse(501, "HTTP_ERROR", "없음");
    }),
  );
  return { calls, details };
}
