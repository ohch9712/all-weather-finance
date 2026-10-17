"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, MessageCircle, Plus } from "lucide-react";
import { Disclaimer } from "@/components/common/Disclaimer";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { Button } from "@/components/ui/button";
import { createConversation } from "../api";
import { chatKeys, useChatStatus, useConversation } from "../hooks";
import type { ConversationDetail } from "../types";
import { useChatStream } from "../use-chat-stream";
import { Composer } from "./Composer";
import { LiveTurnView, ServerMessage } from "./MessageList";

export const EXAMPLE_QUESTIONS = [
  "내 나이대에 맞는 자산배분은?",
  "PER이 뭐야?",
  "이번 달 지출 요약해줘",
  "자녀에게 증여하면 세금이 얼마야?",
];

export const PROVIDER_OFF_TEXT =
  "AI 상담을 쓰려면 서버에 로컬 AI(Ollama)를 설정하거나, 결제가 연결된 Gemini 키를 설정해야 합니다.";
export const READ_ONLY_TEXT = "AI 설정이 바뀌어 이 대화는 읽기만 할 수 있어요.";
export const LIMIT_TEXT = "오늘 대화 한도를 다 썼어요. 내일 다시 이용해 주세요.";

interface ChatThreadProps {
  /** 없으면 새 대화. 첫 질문을 보낼 때 대화를 만든다. */
  conversationId: string | null;
  /** 첫 질문에서 대화를 만들었을 때 */
  onConversationCreated: (id: string) => void;
  /** 읽기 전용 대화에서 "새 대화"를 눌렀을 때 */
  onNewConversation: () => void;
  /** 입력창에 미리 채울 문장(전송은 사용자가 한다) */
  initialDraft?: string;
}

/** 메시지 목록 + 입력창. /chat과 위젯이 같이 쓴다. */
export function ChatThread({ conversationId, onConversationCreated, onNewConversation, initialDraft = "" }: ChatThreadProps) {
  const queryClient = useQueryClient();
  const status = useChatStatus();
  const detail = useConversation(conversationId);
  const { turn, requestError, sending, send, stop } = useChatStream();
  const [input, setInput] = useState(initialDraft);
  const endRef = useRef<HTMLDivElement>(null);

  const conversation = detail.data?.conversation;
  const messages = (detail.data?.messages ?? []).filter((message) => !turn?.turnId || message.turnId !== turn.turnId);
  const providerOff = status.data !== undefined && !status.data.enabled;
  const readOnly = conversation !== undefined && !conversation.canContinue;
  const remaining = status.data ? Math.max(0, status.data.dailyLimit - status.data.usedToday) : null;
  const limitReached = remaining === 0 || requestError?.code === "CHAT_LIMIT_EXCEEDED";
  const empty = messages.length === 0 && !turn;

  // 새 글자·도구 상태가 오면 맨 아래로 내린다.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, turn?.text, turn?.tools.length, turn?.cards.length, turn?.phase]);

  async function resolveConversation(): Promise<string> {
    if (conversationId) return conversationId;
    const created = await createConversation();
    // 새 대화는 비어 있으므로 상세를 다시 부르지 않는다.
    queryClient.setQueryData<ConversationDetail>(chatKeys.conversation(created.id), {
      conversation: created,
      messages: [],
    });
    onConversationCreated(created.id);
    return created.id;
  }

  async function submit(text: string) {
    const question = text.trim();
    if (!question || sending) return;
    setInput("");
    const result = await send({ resolveConversation, question });
    if (result === "rejected") setInput(question);
  }

  let footer;
  if (status.isPending) {
    footer = null;
  } else if (providerOff) {
    footer = (
      <p role="note" className="rounded-lg bg-muted px-3 py-3 text-sm break-keep">
        {PROVIDER_OFF_TEXT}
      </p>
    );
  } else if (readOnly) {
    footer = (
      <div role="note" className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-3 text-sm sm:flex-row sm:items-center">
        <p className="flex-1 break-keep">{READ_ONLY_TEXT}</p>
        <Button type="button" variant="outline" size="sm" onClick={onNewConversation}>
          <Plus aria-hidden="true" />새 대화
        </Button>
      </div>
    );
  } else {
    footer = (
      <>
        {limitReached && (
          <p role="note" className="rounded-lg bg-muted px-3 py-2 text-sm break-keep">
            {LIMIT_TEXT}
          </p>
        )}
        <Composer
          value={input}
          onChange={setInput}
          onSend={() => void submit(input)}
          onStop={stop}
          sending={sending}
          disabled={limitReached}
          remaining={remaining}
          location={status.data?.location ?? null}
        />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4" aria-live="polite">
        {conversationId !== null && detail.isPending ? (
          <LoadingState rows={2} />
        ) : detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        ) : (
          <div className="flex flex-col gap-4">
            {empty && (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <MessageCircle className="size-8 text-muted-foreground" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-medium">무엇이든 물어보세요</p>
                  <p className="text-sm text-muted-foreground break-keep">
                    자산배분, 가계부, 주식 용어처럼 궁금한 것을 쉬운 말로 알려 드려요.
                  </p>
                </div>
                {!providerOff && !readOnly && (
                  <div className="grid w-full max-w-md gap-2 sm:grid-cols-2">
                    {EXAMPLE_QUESTIONS.map((question) => (
                      <Button
                        key={question}
                        type="button"
                        variant="outline"
                        className="h-auto min-h-9 justify-start py-2 text-left whitespace-normal break-keep"
                        disabled={sending || limitReached || status.isPending}
                        onClick={() => void submit(question)}
                      >
                        {question}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {messages.map((message) => (
              <ServerMessage key={message.id} message={message} />
            ))}
            {turn && <LiveTurnView turn={turn} />}
            {requestError && requestError.code !== "CHAT_LIMIT_EXCEEDED" && (
              <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive break-keep">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {requestError.message}
              </p>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>
      <div className="space-y-2 border-t px-3 py-3 sm:px-4">
        {footer}
        {/* AI 고지는 입력 가능 여부(읽기 전용·공급자 꺼짐)와 상관없이 늘 붙인다. 저장된 AI 답변에도 필요하다. */}
        <Disclaimer variant="ai" />
      </div>
    </div>
  );
}
