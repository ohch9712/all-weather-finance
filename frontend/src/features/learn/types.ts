// 학습 게시판 API 타입(스펙 07 6절). 필드 이름은 백엔드 camelCase 그대로다.

export const POST_KINDS = ["article", "video", "glossary"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const POST_LEVELS = ["beginner", "basic", "intermediate"] as const;
export type PostLevel = (typeof POST_LEVELS)[number];

export interface PostSummary {
  id: string;
  kind: PostKind;
  slug: string;
  title: string;
  /** 목록·용어 한 줄 정의 */
  summary: string;
  term: string | null;
  level: PostLevel;
  tags: string[];
  videoId: string | null;
  aiAssisted: boolean;
  /** ISO 8601 UTC */
  publishedAt: string | null;
  bookmarked: boolean;
  read: boolean;
}

export interface PostDetail extends PostSummary {
  bodyMd: string;
  videoUrl: string | null;
  /** 태그가 겹치는 공개 게시물 최대 3개 */
  related: PostSummary[];
}

export interface GlossaryItem {
  id: string;
  slug: string;
  term: string;
  summary: string;
  /** ㄱ~ㅎ, A~Z, # */
  initial: string;
  read: boolean;
}

export interface GlossaryList {
  items: GlossaryItem[];
}

export interface TodayResponse {
  post: PostSummary | null;
}

export interface KindProgress {
  read: number;
  published: number;
}

export interface LearnProgress {
  readCount: number;
  publishedCount: number;
  byKind: Record<PostKind, KindProgress>;
}

/** `GET /api/learn/posts` 쿼리. 빈 값은 보내지 않는다. */
export interface PostListParams {
  kind: PostKind | null;
  level: PostLevel | null;
  tag: string | null;
  q: string;
  bookmarked: boolean;
  page: number;
  pageSize: number;
}

export interface GlossaryParams {
  q: string;
  initial: string | null;
}

// ── 관리자 ───────────────────────────────────────────────────────────

/** 4.1 컬럼 전부 */
export interface AdminPost {
  id: string;
  kind: PostKind;
  slug: string;
  title: string;
  summary: string;
  bodyMd: string;
  term: string | null;
  videoUrl: string | null;
  videoId: string | null;
  level: PostLevel;
  tags: string[];
  published: boolean;
  publishedAt: string | null;
  aiAssisted: boolean;
  authorId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 생성·수정 본문. `slug`가 null이면 서버가 `p-<8자리 hex>`를 만든다. */
export interface AdminPostInput {
  kind: PostKind;
  slug: string | null;
  title: string;
  summary: string;
  bodyMd: string;
  term: string | null;
  videoUrl: string | null;
  level: PostLevel;
  tags: string[];
  published: boolean;
  aiAssisted: boolean;
}

export interface AdminListParams {
  published: boolean | null;
  kind: PostKind | null;
  q: string;
  page: number;
  pageSize: number;
}

export interface DraftRequest {
  kind: PostKind;
  topic: string;
  level: PostLevel;
}

export interface Draft {
  title: string;
  summary: string;
  term: string | null;
  bodyMd: string;
  tags: string[];
}
