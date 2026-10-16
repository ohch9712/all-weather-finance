// 챗봇 API 타입(스펙 09 7·8절). 필드 이름은 백엔드 camelCase 그대로다.

export type ChatProviderName = "gemini" | "ollama";

/** 화면 카드(프론트·백엔드 공통 계약, 스펙 7절). 15가 타입을 추가한다. */
export type KeyValueCard = { type: "key_value"; title: string; items: { label: string; value: string }[] };
export type TableCard = {
  type: "table";
  title: string;
  columns: { key: string; label: string; align?: "left" | "right" }[];
  rows: Record<string, string>[];
  footnote?: string;
};
/** 앱 내부 경로("/"로 시작)만 */
export type LinkCard = { type: "link"; title: string; description?: string; href: string };
export type Card = KeyValueCard | TableCard | LinkCard;

export interface ChatStatus {
  enabled: boolean;
  provider: ChatProviderName | null;
  location: "cloud" | "local" | null;
  model: string | null;
  dailyLimit: number;
  usedToday: number;
}

export interface Conversation {
  id: string;
  title: string;
  provider: ChatProviderName;
  model: string;
  canContinue: boolean;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface ToolCallView {
  name: string;
  label: string;
  ok: boolean;
}

/** 턴 단위로 합친 화면용 메시지 */
export interface DisplayMessage {
  id: string;
  turnId: string;
  role: "user" | "assistant";
  text: string;
  toolCalls: ToolCallView[];
  /** 모르는 타입이 섞여 올 수 있다(렌더러가 무시한다). */
  cards: { type: string }[];
  createdAt: string;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: DisplayMessage[];
}

export interface ConversationCreateInput {
  title?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

/** SSE 이벤트(스펙 8.1) */
export type ChatStreamEvent =
  | {
      event: "message_start";
      data: { conversationId: string; turnId: string; questionMessageId: string; provider: ChatProviderName; model: string };
    }
  | { event: "text_delta"; data: { text: string } }
  | { event: "tool_start"; data: { toolUseId: string; name: string; label: string } }
  | { event: "tool_end"; data: { toolUseId: string; name: string; ok: boolean; card: { type: string } | null } }
  | { event: "message_end"; data: { messageId: string; stopReason: string; model: string; usage: Usage } }
  | { event: "error"; data: { code: string; message: string } };
