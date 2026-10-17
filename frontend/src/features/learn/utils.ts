import { POST_KINDS, POST_LEVELS, type PostKind, type PostLevel } from "./types";

export const KIND_LABEL: Record<PostKind, string> = { article: "글", video: "영상", glossary: "용어" };
export const LEVEL_LABEL: Record<PostLevel, string> = { beginner: "입문", basic: "기초", intermediate: "중급" };

export const PAGE_SIZE = 12;
export const ADMIN_PAGE_SIZE = 20;

// 입력 제한(스펙 07 4.1). 서버도 같은 값으로 검사한다.
export const LIMITS = {
  title: 100,
  summary: 200,
  slug: 80,
  term: 50,
  body: 20_000,
  tags: 10,
  tag: 20,
  videoUrl: 500,
  topic: 100,
} as const;

/**
 * 태그 선택 칸에 보여 줄 태그. 태그 목록 API가 없으므로 시드 콘텐츠가 쓰는 태그를 둔다.
 * 다른 태그는 상세 화면의 태그를 눌러 거를 수 있다.
 */
export const SUGGESTED_TAGS = [
  "기초",
  "입문",
  "주식",
  "채권",
  "ETF",
  "펀드",
  "배당",
  "지표",
  "가치평가",
  "수익성",
  "주문",
  "계좌",
  "시장",
  "지수",
  "분산투자",
  "자산배분",
  "리밸런싱",
  "위험관리",
  "경제",
  "금리",
  "환율",
  "절세계좌",
  "연금",
  "매매일지",
] as const;

/** 초성 색인 바 순서: ㄱ~ㅎ, A~Z, # */
export const GLOSSARY_INITIALS: readonly string[] = [
  ..."ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "#",
];

export function isPostKind(value: string | null | undefined): value is PostKind {
  return (POST_KINDS as readonly string[]).includes(value ?? "");
}

export function isPostLevel(value: string | null | undefined): value is PostLevel {
  return (POST_LEVELS as readonly string[]).includes(value ?? "");
}

/** YouTube 개인정보 보호 강화 모드(쿠키 없는 도메인) 임베드 주소 */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;
}

/** `/learn/[slug]` 경로 */
export function postHref(slug: string): string {
  return `/learn/${encodeURIComponent(slug)}`;
}

// ── /learn 필터(URL 쿼리) ─────────────────────────────────────────────

export interface LearnFilters {
  kind: PostKind | null;
  level: PostLevel | null;
  tag: string | null;
  q: string;
  bookmarked: boolean;
  page: number;
}

interface SearchParamsLike {
  get(name: string): string | null;
}

function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** 알 수 없는 값은 버린다(잘못된 링크로 422가 나지 않게 한다). */
export function parseLearnFilters(params: SearchParamsLike): LearnFilters {
  const kind = params.get("kind");
  const level = params.get("level");
  return {
    kind: isPostKind(kind) ? kind : null,
    level: isPostLevel(level) ? level : null,
    tag: params.get("tag")?.trim() || null,
    q: params.get("q")?.trim() ?? "",
    bookmarked: params.get("bookmarked") === "true",
    page: parsePage(params.get("page")),
  };
}

export function buildLearnQuery(filters: LearnFilters): string {
  const search = new URLSearchParams();
  if (filters.kind) search.set("kind", filters.kind);
  if (filters.level) search.set("level", filters.level);
  if (filters.tag) search.set("tag", filters.tag);
  if (filters.q) search.set("q", filters.q);
  if (filters.bookmarked) search.set("bookmarked", "true");
  if (filters.page > 1) search.set("page", String(filters.page));
  return search.toString();
}

/** `/learn?tag=…` 링크(상세의 태그) */
export function tagHref(tag: string): string {
  return `/learn?${new URLSearchParams({ tag })}`;
}

// ── /learn/glossary 필터 ─────────────────────────────────────────────

export interface GlossaryFilters {
  q: string;
  initial: string | null;
}

export function parseGlossaryFilters(params: SearchParamsLike): GlossaryFilters {
  const initial = params.get("initial");
  return {
    q: params.get("q")?.trim() ?? "",
    initial: initial && GLOSSARY_INITIALS.includes(initial) ? initial : null,
  };
}

export function buildGlossaryQuery(filters: GlossaryFilters): string {
  const search = new URLSearchParams();
  if (filters.initial) search.set("initial", filters.initial);
  if (filters.q) search.set("q", filters.q);
  return search.toString();
}

// ── 관리자 폼 ────────────────────────────────────────────────────────

/** "기초, 지표 ,기초" → ["기초", "지표"] */
export function splitTags(text: string): string[] {
  const tags: string[] = [];
  for (const part of text.split(/[,，]/)) {
    const tag = part.trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function joinTags(tags: readonly string[]): string {
  return tags.join(", ");
}
