"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createConversation, deleteConversation, getChatStatus, getConversation, listConversations } from "./api";
import type { ConversationCreateInput } from "./types";

export const CONVERSATION_PAGE_SIZE = 20;

export const chatKeys = {
  all: ["chat"] as const,
  status: () => ["chat", "status"] as const,
  conversations: () => ["chat", "conversations"] as const,
  latest: () => ["chat", "conversations", "latest"] as const,
  conversation: (id: string) => ["chat", "conversation", id] as const,
};

export function useChatStatus() {
  return useQuery({ queryKey: chatKeys.status(), queryFn: getChatStatus });
}

/** 대화 목록(최근 대화 순, 더 보기) */
export function useConversations() {
  return useInfiniteQuery({
    queryKey: chatKeys.conversations(),
    queryFn: ({ pageParam }) => listConversations(pageParam, CONVERSATION_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
}

/** 위젯이 열 때 쓰는 가장 최근 대화. 없으면 null */
export function useLatestConversation(enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.latest(),
    queryFn: async () => (await listConversations(1, 1)).items[0] ?? null,
    enabled,
    staleTime: 0,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: chatKeys.conversation(id ?? ""),
    queryFn: () => getConversation(id as string),
    enabled: id !== null,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input?: ConversationCreateInput) => createConversation(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKeys.conversations() }),
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: chatKeys.conversation(id) });
      return queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}
