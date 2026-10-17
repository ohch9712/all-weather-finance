import { apiFetch } from "@/lib/api-client";
import type { Page } from "@/types/api";
import type { ChatStatus, Conversation, ConversationCreateInput, ConversationDetail } from "./types";

// 메시지 전송(SSE)은 sse.ts의 streamChatMessage를 쓴다.

export function getChatStatus(): Promise<ChatStatus> {
  return apiFetch<ChatStatus>("/api/chat/status");
}

export function listConversations(page: number, pageSize: number): Promise<Page<Conversation>> {
  return apiFetch<Page<Conversation>>(`/api/chat/conversations?page=${page}&pageSize=${pageSize}`);
}

export function createConversation(input: ConversationCreateInput = {}): Promise<Conversation> {
  return apiFetch<Conversation>("/api/chat/conversations", { method: "POST", body: JSON.stringify(input) });
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(`/api/chat/conversations/${id}`);
}

export async function deleteConversation(id: string): Promise<void> {
  await apiFetch<void>(`/api/chat/conversations/${id}`, { method: "DELETE" });
}
