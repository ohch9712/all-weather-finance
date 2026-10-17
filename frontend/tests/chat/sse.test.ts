import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { SseParser, streamChatMessage, toStreamEvent } from "@/features/chat/sse";
import type { ChatStreamEvent } from "@/features/chat/types";
import { ApiError } from "@/lib/api-client";
import { apiUrl, errorResponse, server } from "../utils";
import { CONVERSATION_ID, sseStream } from "./fake-chat";

describe("SseParser", () => {
  it("여러 이벤트를 한 청크에서 읽는다", () => {
    const parser = new SseParser();
    const messages = parser.push(
      'event: message_start\ndata: {"turnId":"t"}\n\nevent: text_delta\ndata: {"text":"현재 "}\n\n',
    );
    expect(messages).toEqual([
      { event: "message_start", data: '{"turnId":"t"}' },
      { event: "text_delta", data: '{"text":"현재 "}' },
    ]);
  });

  it("줄·이벤트 경계가 청크 사이에 걸쳐도 이어 붙인다", () => {
    const parser = new SseParser();
    const text = 'event: text_delta\ndata: {"text":"안녕하세요"}\n\nevent: text_delta\ndata: {"text":"!"}\n\n';
    const received = [];
    // 한 글자씩 쪼개서 넣는다(한글 중간·"\n" 사이 포함).
    for (const char of text) received.push(...parser.push(char));
    expect(received.map((message) => JSON.parse(message.data).text)).toEqual(["안녕하세요", "!"]);
    expect(parser.push("event: tex")).toEqual([]);
    expect(parser.push('t_delta\ndata: {"te')).toEqual([]);
    expect(parser.push('xt":"a"}\n')).toEqual([]);
    expect(parser.push("\n")).toEqual([{ event: "text_delta", data: '{"text":"a"}' }]);
  });

  it("ping 주석을 무시하고 \\r\\n 줄 끝도 읽는다", () => {
    const parser = new SseParser();
    expect(parser.push(": ping\n\n: ping\n\n")).toEqual([]);
    expect(parser.push('event: error\r\ndata: {"code":"LLM_UNAVAILABLE","message":"끊김"}\r')).toEqual([]);
    expect(parser.push("\n\r\n")).toEqual([{ event: "error", data: '{"code":"LLM_UNAVAILABLE","message":"끊김"}' }]);
  });

  it("에러 이벤트를 타입 있는 이벤트로 바꾸고 모르는 이벤트는 버린다", () => {
    expect(toStreamEvent({ event: "error", data: '{"code":"LLM_REFUSED","message":"거절"}' })).toEqual({
      event: "error",
      data: { code: "LLM_REFUSED", message: "거절" },
    });
    expect(toStreamEvent({ event: "unknown", data: "{}" })).toBeNull();
    expect(toStreamEvent({ event: "text_delta", data: "{깨짐" })).toBeNull();
  });
});

describe("streamChatMessage", () => {
  const url = apiUrl(`/api/chat/conversations/${CONVERSATION_ID}/messages`);

  it("POST로 보내고 청크로 나뉜 이벤트를 차례로 넘긴다", async () => {
    const stream = sseStream();
    let request: Request | undefined;
    server.use(
      http.post(url, ({ request: incoming }) => {
        request = incoming;
        return stream.response();
      }),
    );
    const events: ChatStreamEvent[] = [];
    const done = streamChatMessage(CONVERSATION_ID, "내 나이대 알려줘", { onEvent: (event) => events.push(event) });
    stream.push('event: message_start\ndata: {"turnId":"t","conversationId":"c"');
    stream.push('}\n\n: ping\n\nevent: text_delta\ndata: {"text":"현재 "}\n');
    stream.push('\nevent: error\ndata: {"code":"LLM_UNAVAILABLE","message":"응답이 너무 길어 중단됐어요."}\n\n');
    stream.close();
    await done;
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(await request?.clone().json()).toEqual({ content: "내 나이대 알려줘" });
    expect(events.map((event) => event.event)).toEqual(["message_start", "text_delta", "error"]);
    expect(events[2].data).toEqual({ code: "LLM_UNAVAILABLE", message: "응답이 너무 길어 중단됐어요." });
  });

  it("2xx가 아니면 JSON 에러 본문을 ApiError로 던진다", async () => {
    server.use(
      http.post(url, () => errorResponse(429, "CHAT_LIMIT_EXCEEDED", "오늘 대화 한도를 다 썼어요. 내일 다시 이용해 주세요.")),
    );
    const error = await streamChatMessage(CONVERSATION_ID, "질문", { onEvent: () => {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "CHAT_LIMIT_EXCEEDED" });
  });

  it("JSON이 아닌 오류 본문은 일반 오류로 바꾼다", async () => {
    server.use(http.post(url, () => new HttpResponse("bad gateway", { status: 502 })));
    const error = await streamChatMessage(CONVERSATION_ID, "질문", { onEvent: () => {} }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: "UNKNOWN_ERROR" });
  });

  it("멈추면 AbortError로 끝난다", async () => {
    const stream = sseStream();
    server.use(http.post(url, () => stream.response()));
    const controller = new AbortController();
    const events: ChatStreamEvent[] = [];
    const done = streamChatMessage(CONVERSATION_ID, "질문", {
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
        controller.abort();
      },
    });
    stream.event("message_start", { turnId: "t" });
    const error = await done.catch((e: unknown) => e);
    expect((error as Error).name).toBe("AbortError");
    expect(events).toHaveLength(1);
  });
});
