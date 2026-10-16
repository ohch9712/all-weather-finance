import {
  API_BASE_URL,
  ApiError,
  NETWORK_ERROR_MESSAGE,
  UNKNOWN_ERROR_MESSAGE,
  type ApiErrorDetail,
} from "@/lib/api-client";
import type { ChatStreamEvent } from "./types";

// 메시지 전송 SSE 클라이언트(스펙 09 9.3).
// EventSource는 POST·쿠키 제어가 안 되어 쓰지 않고, fetch 본문을 읽어 이벤트를 직접 파싱한다.

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * SSE 본문 파서. 청크를 넣으면 완성된 이벤트를 돌려준다.
 * 줄·이벤트 경계가 청크 사이에 걸쳐도 남은 부분을 다음 청크와 이어 붙인다. `:`로 시작하는 줄(ping)은 무시한다.
 */
export class SseParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      // "\r\n"의 "\r"은 줄 끝에서 지운다(청크 경계에서 "\r"과 "\n"이 나뉘어도 된다).
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      this.line(line, messages);
      newline = this.buffer.indexOf("\n");
    }
    return messages;
  }

  private line(line: string, messages: SseMessage[]) {
    if (line === "") {
      if (this.data.length > 0) messages.push({ event: this.event || "message", data: this.data.join("\n") });
      this.event = "";
      this.data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
  }
}

const KNOWN_EVENTS = new Set(["message_start", "text_delta", "tool_start", "tool_end", "message_end", "error"]);

export function toStreamEvent(message: SseMessage): ChatStreamEvent | null {
  if (!KNOWN_EVENTS.has(message.event)) return null;
  try {
    return { event: message.event, data: JSON.parse(message.data) } as ChatStreamEvent;
  } catch {
    return null;
  }
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; message?: unknown; details?: unknown };
    };
    const error = body?.error;
    if (error && typeof error.code === "string" && typeof error.message === "string") {
      const details = Array.isArray(error.details) ? (error.details as ApiErrorDetail[]) : [];
      return new ApiError(response.status, error.code, error.message, details);
    }
  } catch {
    // 본문이 JSON이 아니면 일반 문구를 쓴다.
  }
  return new ApiError(response.status, "UNKNOWN_ERROR", UNKNOWN_ERROR_MESSAGE);
}

function isAbortError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

interface StreamOptions {
  signal?: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

/**
 * `POST /api/chat/conversations/{id}/messages`를 보내고 SSE 이벤트를 차례로 넘긴다.
 * 2xx가 아니면 JSON 에러 본문을 `ApiError`로 던진다. 호출자가 중단하면 AbortError를 그대로 던진다.
 */
export async function streamChatMessage(conversationId: string, content: string, { signal, onEvent }: StreamOptions) {
  let response: Response;
  try {
    // 스트리밍 응답이라 lib/api-client의 apiFetch(타임아웃·JSON 본문)를 쓸 수 없다(스펙 09 9.3).
    response = await globalThis.fetch(
      `${API_BASE_URL.replace(/\/+$/, "")}/api/chat/conversations/${conversationId}/messages`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ content }),
        signal,
      },
    );
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    throw new ApiError(0, "NETWORK_ERROR", NETWORK_ERROR_MESSAGE);
  }
  if (!response.ok) throw await readError(response);
  if (!response.body) throw new ApiError(response.status, "UNKNOWN_ERROR", UNKNOWN_ERROR_MESSAGE);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const emit = (messages: SseMessage[]) => {
    for (const message of messages) {
      const event = toStreamEvent(message);
      if (event) onEvent(event);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      emit(parser.push(decoder.decode(value, { stream: true })));
    }
    emit(parser.push(decoder.decode()));
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    throw new ApiError(0, "NETWORK_ERROR", NETWORK_ERROR_MESSAGE);
  } finally {
    reader.releaseLock();
  }
}
