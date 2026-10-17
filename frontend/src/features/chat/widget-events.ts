// 다른 화면이 챗봇 위젯을 여는 작은 이벤트(스펙 09 9.2). 위젯이 window의 `chat:open`을 구독한다.

export const CHAT_OPEN_EVENT = "chat:open";

export interface OpenChatWidgetOptions {
  /** 입력창에 채울 문장. 전송은 사용자가 한다. */
  draft?: string;
}

export function openChatWidget(options: OpenChatWidgetOptions = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenChatWidgetOptions>(CHAT_OPEN_EVENT, { detail: options }));
}
