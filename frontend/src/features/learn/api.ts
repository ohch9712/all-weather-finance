import { apiFetch } from "@/lib/api-client";
import type { Page } from "@/types/api";
import type {
  AdminListParams,
  AdminPost,
  AdminPostInput,
  Draft,
  DraftRequest,
  GlossaryList,
  GlossaryParams,
  LearnProgress,
  PostDetail,
  PostListParams,
  PostSummary,
  TodayResponse,
} from "./types";

// ── 사용자용 ─────────────────────────────────────────────────────────

/** 빈 필터는 보내지 않는다. */
export function getPosts(params: PostListParams): Promise<Page<PostSummary>> {
  const search = new URLSearchParams();
  if (params.kind) search.set("kind", params.kind);
  if (params.level) search.set("level", params.level);
  if (params.tag) search.set("tag", params.tag);
  if (params.q) search.set("q", params.q);
  if (params.bookmarked) search.set("bookmarked", "true");
  search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize));
  return apiFetch<Page<PostSummary>>(`/api/learn/posts?${search}`);
}

export function getPost(slug: string): Promise<PostDetail> {
  return apiFetch<PostDetail>(`/api/learn/posts/${encodeURIComponent(slug)}`);
}

export async function addBookmark(id: string): Promise<void> {
  await apiFetch<void>(`/api/learn/posts/${id}/bookmark`, { method: "POST" });
}

export async function removeBookmark(id: string): Promise<void> {
  await apiFetch<void>(`/api/learn/posts/${id}/bookmark`, { method: "DELETE" });
}

export async function markRead(id: string): Promise<void> {
  await apiFetch<void>(`/api/learn/posts/${id}/read`, { method: "POST" });
}

export function getGlossary(params: GlossaryParams): Promise<GlossaryList> {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.initial) search.set("initial", params.initial);
  const query = search.toString();
  return apiFetch<GlossaryList>(`/api/learn/glossary${query ? `?${query}` : ""}`);
}

export function getToday(): Promise<TodayResponse> {
  return apiFetch<TodayResponse>("/api/learn/today");
}

export function getProgress(): Promise<LearnProgress> {
  return apiFetch<LearnProgress>("/api/learn/progress");
}

// ── 관리자용 ─────────────────────────────────────────────────────────

export function getAdminPosts(params: AdminListParams): Promise<Page<AdminPost>> {
  const search = new URLSearchParams();
  if (params.published !== null) search.set("published", String(params.published));
  if (params.kind) search.set("kind", params.kind);
  if (params.q) search.set("q", params.q);
  search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize));
  return apiFetch<Page<AdminPost>>(`/api/learn/admin/posts?${search}`);
}

export function getAdminPost(id: string): Promise<AdminPost> {
  return apiFetch<AdminPost>(`/api/learn/admin/posts/${id}`);
}

export function createPost(input: AdminPostInput): Promise<AdminPost> {
  return apiFetch<AdminPost>("/api/learn/admin/posts", { method: "POST", body: JSON.stringify(input) });
}

export function updatePost(id: string, input: Partial<AdminPostInput>): Promise<AdminPost> {
  return apiFetch<AdminPost>(`/api/learn/admin/posts/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deletePost(id: string): Promise<void> {
  await apiFetch<void>(`/api/learn/admin/posts/${id}`, { method: "DELETE" });
}

/** AI 초안은 응답이 느릴 수 있어 기본 타임아웃(10초)보다 길게 기다린다. */
export function createAiDraft(input: DraftRequest): Promise<Draft> {
  return apiFetch<Draft>("/api/learn/admin/ai-draft", {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: 120_000,
  });
}
