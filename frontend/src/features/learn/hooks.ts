"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addBookmark,
  createAiDraft,
  createPost,
  deletePost,
  getAdminPost,
  getAdminPosts,
  getGlossary,
  getPost,
  getPosts,
  getProgress,
  getToday,
  markRead,
  removeBookmark,
  updatePost,
} from "./api";
import type { AdminListParams, AdminPostInput, GlossaryParams, PostListParams } from "./types";

export const learnKeys = {
  all: ["learn"] as const,
  posts: () => ["learn", "posts"] as const,
  postList: (params: PostListParams) => ["learn", "posts", params] as const,
  details: () => ["learn", "post"] as const,
  detail: (slug: string) => ["learn", "post", slug] as const,
  glossaries: () => ["learn", "glossary"] as const,
  glossary: (params: GlossaryParams) => ["learn", "glossary", params] as const,
  today: () => ["learn", "today"] as const,
  progress: () => ["learn", "progress"] as const,
  admin: () => ["learn", "admin"] as const,
  adminList: (params: AdminListParams) => ["learn", "admin", "list", params] as const,
  adminPost: (id: string) => ["learn", "admin", "post", id] as const,
};

/** 북마크·읽음 표시는 목록·상세·오늘의 용어·용어 사전·진도에 함께 보인다. */
function invalidateUserState(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === "learn" && query.queryKey[1] !== "admin",
  });
}

export function usePosts(params: PostListParams) {
  return useQuery({
    queryKey: learnKeys.postList(params),
    queryFn: () => getPosts(params),
    placeholderData: keepPreviousData,
  });
}

export function usePost(slug: string) {
  return useQuery({ queryKey: learnKeys.detail(slug), queryFn: () => getPost(slug) });
}

export function useGlossary(params: GlossaryParams) {
  return useQuery({
    queryKey: learnKeys.glossary(params),
    queryFn: () => getGlossary(params),
    placeholderData: keepPreviousData,
    select: (data) => data.items,
  });
}

export function useToday() {
  return useQuery({ queryKey: learnKeys.today(), queryFn: getToday, select: (data) => data.post });
}

export function useProgress() {
  return useQuery({ queryKey: learnKeys.progress(), queryFn: getProgress });
}

export function useToggleBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, bookmarked }: { id: string; bookmarked: boolean }) =>
      bookmarked ? addBookmark(id) : removeBookmark(id),
    onSuccess: () => invalidateUserState(queryClient),
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markRead,
    onSuccess: () => invalidateUserState(queryClient),
  });
}

// ── 관리자 ───────────────────────────────────────────────────────────

/** 게시물이 바뀌면 관리자 목록과 사용자 화면을 모두 다시 불러온다. */
function invalidateAll(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: learnKeys.all });
}

export function useAdminPosts(params: AdminListParams) {
  return useQuery({
    queryKey: learnKeys.adminList(params),
    queryFn: () => getAdminPosts(params),
    placeholderData: keepPreviousData,
  });
}

export function useAdminPost(id: string | undefined) {
  return useQuery({
    queryKey: learnKeys.adminPost(id ?? ""),
    queryFn: () => getAdminPost(id as string),
    enabled: Boolean(id),
  });
}

export function useSavePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: AdminPostInput }) => (id ? updatePost(id, input) : createPost(input)),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useSetPublished() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => updatePost(id, { published }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePost,
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useAiDraft() {
  return useMutation({ mutationFn: createAiDraft });
}
