"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, getErrorMessage, isApiError } from "@/lib/api-client";
import { chatKeys } from "./hooks";
import { streamChatMessage } from "./sse";
import type { ChatStreamEvent } from "./types";

export type LiveToolStatus = "running" | "ok" | "error";

export interface LiveTool {
  toolUseId: string;
  name: string;
  label: string;
  status: LiveToolStatus;
}

/** 지금 주고받는 한 턴. 끝난 뒤에도 다음 질문 전까지 이 내용으로 보여 준다(서버 기록의 같은 턴은 숨긴다). */
export interface LiveTurn {
  turnId: string | null;
  question: string;
  text: string;
  tools: LiveTool[];
  cards: { type: string }[];
  phase: "streaming" | "done" | "error" | "stopped";
  /** 이번 라운드의 글자를 아직 받지 못함("답을 만드는 중" 표시) */
  awaitingText: boolean;
  /** 도구를 실행한 뒤 다음 라운드 글자 앞에 줄을 띄운다(서버 기록 합치기와 같게). */
  separateNext: boolean;
  error: string | null;
}

function applyEvent(turn: LiveTurn, event: ChatStreamEvent): LiveTurn {
  switch (event.event) {
    case "message_start":
      return { ...turn, turnId: event.data.turnId };
    case "text_delta": {
      const prefix = turn.separateNext && turn.text ? "\n\n" : "";
      return { ...turn, text: turn.text + prefix + event.data.text, awaitingText: false, separateNext: false };
    }
    case "tool_start":
      return {
        ...turn,
        awaitingText: false,
        tools: [
          ...turn.tools,
          { toolUseId: event.data.toolUseId, name: event.data.name, label: event.data.label, status: "running" },
        ],
      };
    case "tool_end":
      return {
        ...turn,
        awaitingText: true,
        separateNext: true,
        tools: turn.tools.map((tool) =>
          tool.toolUseId === event.data.toolUseId ? { ...tool, status: event.data.ok ? "ok" : "error" } : tool,
        ),
        cards: event.data.card ? [...turn.cards, event.data.card] : turn.cards,
      };
    case "message_end":
      return { ...turn, phase: "done", awaitingText: false };
    case "error":
      return { ...turn, phase: "error", awaitingText: false, error: event.data.message };
    default:
      return turn;
  }
}

function isAbortError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

interface SendOptions {
  /** 대화 id. 없으면 만들고 돌려준다(첫 질문에서 대화를 만든다). */
  resolveConversation: () => Promise<string>;
  question: string;
}

/** 메시지 전송 상태: 받은 글자 이어 붙이기, 도구 칩 상태, 카드, 멈추기 */
export function useChatStream() {
  const queryClient = useQueryClient();
  const [turn, setTurn] = useState<LiveTurn | null>(null);
  /** SSE를 열기 전에 받은 JSON 오류(상한·공급자 바뀜·꺼짐 등) */
  const [requestError, setRequestError] = useState<ApiError | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // 화면을 떠나면 진행 중인 요청을 끊는다(서버는 진행 중인 라운드를 저장하지 않는다).
  useEffect(() => () => controllerRef.current?.abort(), []);

  const refresh = useCallback(
    (conversationId: string | null) => {
      if (conversationId) void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
      void queryClient.invalidateQueries({ queryKey: chatKeys.status() });
    },
    [queryClient],
  );

  const send = useCallback(
    async ({ resolveConversation, question }: SendOptions): Promise<"ok" | "rejected"> => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setRequestError(null);
      setTurn({
        turnId: null,
        question,
        text: "",
        tools: [],
        cards: [],
        phase: "streaming",
        awaitingText: true,
        separateNext: false,
        error: null,
      });
      let conversationId: string | null = null;
      let started = false;
      try {
        conversationId = await resolveConversation();
        await streamChatMessage(conversationId, question, {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.event === "message_start") started = true;
            setTurn((current) => (current ? applyEvent(current, event) : current));
          },
        });
        // 스트림이 이벤트 없이 끝나면(연결 끊김) 오류로 보여 준다.
        setTurn((current) =>
          current && current.phase === "streaming"
            ? { ...current, phase: "error", awaitingText: false, error: "응답이 중간에 끊겼어요. 다시 시도해 주세요." }
            : current,
        );
        return "ok";
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          // 질문이 저장되기 전에 멈췄다면 서버 기록을 그대로 보여 준다.
          setTurn((current) =>
            current && started ? { ...current, phase: "stopped", awaitingText: false } : null,
          );
          return "ok";
        }
        if (!started) {
          // SSE를 열기 전의 오류: 질문이 저장되지 않았으므로 입력을 되돌려 준다.
          setTurn(null);
          setRequestError(isApiError(error) ? error : new ApiError(0, "UNKNOWN_ERROR", getErrorMessage(error)));
          return "rejected";
        }
        setTurn((current) =>
          current ? { ...current, phase: "error", awaitingText: false, error: getErrorMessage(error) } : current,
        );
        return "ok";
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        refresh(conversationId);
      }
    },
    [refresh],
  );

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  return {
    turn,
    requestError,
    sending: turn?.phase === "streaming",
    send,
    stop,
  };
}
