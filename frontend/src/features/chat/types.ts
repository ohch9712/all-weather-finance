// 챗봇 API 타입(스펙 09 7·8절). 필드 이름은 백엔드 camelCase 그대로다.

export type ChatProviderName = "gemini" | "ollama";

/** 화면 카드(프론트·백엔드 공통 계약, 스펙 09 7절·15 5절). 표시 값은 서버가 형식화한 문자열이다. */
export type KeyValueCard = { type: "key_value"; title: string; items: { label: string; value: string }[] };
export type TableCard = {
  type: "table";
  title: string;
  columns: { key: string; label: string; align?: "left" | "right" }[];
  rows: Record<string, string>[];
  footnote?: string;
  /** 15가 더한 선택 필드. 앱 내부 경로("/"로 시작)면 표 아래에 "자세히 보기" 링크를 그린다. */
  href?: string;
};
/** 앱 내부 경로("/"로 시작)만 */
export type LinkCard = { type: "link"; title: string; description?: string; href: string };

// ── 15 전용 카드 ─────────────────────────────────────────────

export type AllocationCard = {
  type: "allocation";
  status: string;
  score: number | null;
  grade: string | null;
  /** 도넛을 그리므로 비중은 숫자(%)다. */
  classes: { assetClass: string; label: string; actualWeight: number | null; targetWeight: number | null }[];
  href: "/allocation";
};
export type SpendingCard = {
  type: "spending";
  month: string;
  incomeTotal: string;
  expenseTotal: string;
  net: string;
  topCategories: { name: string; amount: string; ratio: string }[];
  href: string;
};
export type StockCard = {
  type: "stock";
  code: string;
  name: string;
  price: string | null;
  changeRate: string | null;
  metrics: { label: string; value: string }[];
  source: string;
  href: string;
};
export type StockListCard = {
  type: "stock_list";
  title: string;
  asOf: string | null;
  source: string;
  items: { code: string; name: string; price: string | null; changeRate: string | null; extra: string | null }[];
  href: string | null;
};
export type GiftTaxCard = {
  type: "gift_tax";
  title: string;
  steps: { label: string; amount: string; note: string | null }[];
  payableTax: string;
  href: string;
};
export type LinkListCard = {
  type: "link_list";
  title: string;
  links: { title: string; description: string | null; href: string }[];
};
export type DirectionsCard = {
  type: "directions";
  title: string;
  items: { title: string; body: string; amount: string | null }[];
  href: "/allocation/recommendation/detail";
};
export type ComparisonCard = {
  type: "comparison";
  title: string;
  horizonDate: string;
  rows: { key: string; label: string; totalTax: string; familyReceives: string; recommended: boolean }[];
  href: "/estate?tab=compare";
};

export type Card =
  | KeyValueCard
  | TableCard
  | LinkCard
  | AllocationCard
  | SpendingCard
  | StockCard
  | StockListCard
  | GiftTaxCard
  | LinkListCard
  | DirectionsCard
  | ComparisonCard;

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
