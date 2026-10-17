import { HttpResponse, http } from "msw";
import type {
  AdminPost,
  AdminPostInput,
  Draft,
  GlossaryItem,
  PostDetail,
  PostKind,
  PostLevel,
  PostSummary,
} from "@/features/learn/types";
import type { AiStatus } from "@/lib/ai-status";
import { apiUrl, errorResponse, server } from "../utils";

// 학습 게시판 API(스펙 07 6절)를 메모리에서 흉내 낸다. 요청은 `requests`에 "METHOD /path?query"로 남는다.

export interface MockPost extends AdminPost {
  bookmarked: boolean;
  read: boolean;
}

export interface MockLearn {
  posts: MockPost[];
  requests: string[];
  bodies: { method: string; path: string; body: unknown }[];
  draft: Draft;
}

let sequence = 0;

export function mockPost(slug: string, fields: Partial<MockPost> = {}): MockPost {
  sequence += 1;
  const kind: PostKind = fields.kind ?? "article";
  return {
    id: `post-${sequence}`,
    kind,
    slug,
    title: `${slug} 제목`,
    summary: `${slug} 요약`,
    bodyMd: "## 소제목\n\n본문이에요.",
    term: kind === "glossary" ? slug.toUpperCase() : null,
    videoUrl: kind === "video" ? "https://youtu.be/dQw4w9WgXcQ" : null,
    videoId: kind === "video" ? "dQw4w9WgXcQ" : null,
    level: "beginner" as PostLevel,
    tags: [],
    published: true,
    publishedAt: "2026-10-16T00:00:00Z",
    aiAssisted: false,
    authorId: null,
    createdAt: "2026-10-16T00:00:00Z",
    updatedAt: "2026-10-16T00:00:00Z",
    bookmarked: false,
    read: false,
    ...fields,
  };
}

export const SAMPLE_POSTS = (): MockPost[] => [
  mockPost("per", {
    kind: "glossary",
    term: "PER",
    title: "PER(주가수익비율)",
    summary: "주가가 1주당 순이익의 몇 배인지 나타내는 지표",
    level: "basic",
    tags: ["지표", "가치평가"],
    read: true,
  }),
  mockPost("bond", { kind: "glossary", term: "채권", title: "채권", summary: "돈을 빌려주고 받는 증서", tags: ["채권"] }),
  mockPost("dividend", { kind: "glossary", term: "배당", title: "배당", summary: "이익을 주주에게 나눠 주는 것", tags: ["배당"] }),
  mockPost("start-with-etf", {
    title: "ETF로 시작하는 분산투자",
    summary: "ETF 한 주로 여러 종목에 나눠 투자하는 원리",
    tags: ["ETF", "지표"],
    publishedAt: "2026-10-15T00:00:00Z",
  }),
  mockPost("intro-video", { kind: "video", title: "주식시장 첫걸음 영상", summary: "영상으로 보는 주식시장", level: "intermediate" }),
];

export function toSummary(post: MockPost): PostSummary {
  return {
    id: post.id,
    kind: post.kind,
    slug: post.slug,
    title: post.title,
    summary: post.summary,
    term: post.term,
    level: post.level,
    tags: post.tags,
    videoId: post.videoId,
    aiAssisted: post.aiAssisted,
    publishedAt: post.publishedAt,
    bookmarked: post.bookmarked,
    read: post.read,
  };
}

function toAdmin(post: MockPost): AdminPost {
  const admin: Partial<MockPost> = { ...post };
  delete admin.bookmarked;
  delete admin.read;
  return admin as AdminPost;
}

function initialOf(term: string): string {
  const code = term.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const choseong = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"[Math.floor((code - 0xac00) / 588)];
    return ({ ㄲ: "ㄱ", ㄸ: "ㄷ", ㅃ: "ㅂ", ㅆ: "ㅅ", ㅉ: "ㅈ" } as Record<string, string>)[choseong] ?? choseong;
  }
  return /[a-z]/i.test(term[0] ?? "") ? term[0].toUpperCase() : "#";
}

function matches(post: MockPost, q: string) {
  const needle = q.toLowerCase();
  return [post.title, post.term ?? "", post.summary, post.bodyMd].some((text) => text.toLowerCase().includes(needle));
}

export function aiStatus(generalEnabled = true): AiStatus {
  return {
    general: generalEnabled
      ? { enabled: true, provider: "gemini", location: "cloud", model: "gemini-3.8-flash", reason: null }
      : { enabled: false, provider: null, location: null, model: null, reason: "not_configured" },
    personal: { enabled: false, provider: null, location: null, model: null, reason: "not_configured" },
  };
}

export function mockLearn(posts: MockPost[] = SAMPLE_POSTS(), options: { aiEnabled?: boolean } = {}): MockLearn {
  const state: MockLearn = {
    posts,
    requests: [],
    bodies: [],
    draft: {
      title: "PBR(주가순자산비율)",
      summary: "주가가 1주당 순자산의 몇 배인지 나타내는 지표",
      term: "PBR",
      bodyMd: "## 한마디로\n\nPBR은 …",
      tags: ["지표", "가치평가"],
    },
  };
  const published = () => state.posts.filter((post) => post.published);
  const find = (id: string) => state.posts.find((post) => post.id === id);

  function record(request: Request) {
    const url = new URL(request.url);
    state.requests.push(`${request.method} ${url.pathname}${url.search}`);
    return url;
  }

  server.use(
    http.get(apiUrl("/api/ai/status"), () => HttpResponse.json(aiStatus(options.aiEnabled ?? true))),
    http.get(apiUrl("/api/learn/posts"), ({ request }) => {
      const url = record(request);
      const params = url.searchParams;
      let items = published();
      if (params.get("kind")) items = items.filter((post) => post.kind === params.get("kind"));
      if (params.get("level")) items = items.filter((post) => post.level === params.get("level"));
      if (params.get("tag")) items = items.filter((post) => post.tags.includes(params.get("tag") as string));
      if (params.get("q")) items = items.filter((post) => matches(post, params.get("q") as string));
      if (params.get("bookmarked") === "true") items = items.filter((post) => post.bookmarked);
      const page = Number(params.get("page") ?? 1);
      const pageSize = Number(params.get("pageSize") ?? 12);
      return HttpResponse.json({
        items: items.slice((page - 1) * pageSize, page * pageSize).map(toSummary),
        page,
        pageSize,
        total: items.length,
      });
    }),
    http.get(apiUrl("/api/learn/posts/:slug"), ({ request, params }) => {
      record(request);
      const post = published().find((item) => item.slug === params.slug);
      if (!post) return errorResponse(404, "NOT_FOUND", "게시물을 찾을 수 없습니다.");
      const detail: PostDetail = {
        ...toSummary(post),
        bodyMd: post.bodyMd,
        videoUrl: post.videoUrl,
        related: published()
          .filter((other) => other.id !== post.id && other.tags.some((tag) => post.tags.includes(tag)))
          .slice(0, 3)
          .map(toSummary),
      };
      return HttpResponse.json(detail);
    }),
    http.post(apiUrl("/api/learn/posts/:id/bookmark"), ({ request, params }) => {
      record(request);
      const post = find(params.id as string);
      if (!post) return errorResponse(404, "NOT_FOUND", "게시물을 찾을 수 없습니다.");
      post.bookmarked = true;
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(apiUrl("/api/learn/posts/:id/bookmark"), ({ request, params }) => {
      record(request);
      const post = find(params.id as string);
      if (post) post.bookmarked = false;
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(apiUrl("/api/learn/posts/:id/read"), ({ request, params }) => {
      record(request);
      const post = find(params.id as string);
      if (post) post.read = true;
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(apiUrl("/api/learn/glossary"), ({ request }) => {
      const url = record(request);
      const q = url.searchParams.get("q");
      const initial = url.searchParams.get("initial");
      const items: GlossaryItem[] = published()
        .filter((post) => post.kind === "glossary")
        .filter((post) => !q || matches(post, q))
        .map((post) => {
          const term = post.term ?? post.title;
          return { id: post.id, slug: post.slug, term, summary: post.summary, initial: initialOf(term), read: post.read };
        })
        .filter((item) => !initial || item.initial === initial)
        .sort((a, b) => {
          const group = (item: GlossaryItem) => (/^[ㄱ-ㅎ]$/.test(item.initial) ? 0 : item.initial === "#" ? 2 : 1);
          return group(a) - group(b) || a.term.localeCompare(b.term, "ko");
        });
      return HttpResponse.json({ items });
    }),
    http.get(apiUrl("/api/learn/today"), ({ request }) => {
      record(request);
      const term = published().find((post) => post.kind === "glossary");
      return HttpResponse.json({ post: term ? toSummary(term) : null });
    }),
    http.get(apiUrl("/api/learn/progress"), ({ request }) => {
      record(request);
      const items = published();
      const byKind = Object.fromEntries(
        (["article", "video", "glossary"] as const).map((kind) => [
          kind,
          {
            read: items.filter((post) => post.kind === kind && post.read).length,
            published: items.filter((post) => post.kind === kind).length,
          },
        ]),
      );
      return HttpResponse.json({
        readCount: items.filter((post) => post.read).length,
        publishedCount: items.length,
        byKind,
      });
    }),
    // ── 관리자 ──
    http.get(apiUrl("/api/learn/admin/posts"), ({ request }) => {
      const url = record(request);
      let items = [...state.posts];
      const publishedParam = url.searchParams.get("published");
      if (publishedParam) items = items.filter((post) => String(post.published) === publishedParam);
      if (url.searchParams.get("kind")) items = items.filter((post) => post.kind === url.searchParams.get("kind"));
      if (url.searchParams.get("q")) items = items.filter((post) => matches(post, url.searchParams.get("q") as string));
      return HttpResponse.json({ items: items.map(toAdmin), page: 1, pageSize: 20, total: items.length });
    }),
    http.get(apiUrl("/api/learn/admin/posts/:id"), ({ request, params }) => {
      record(request);
      const post = find(params.id as string);
      return post ? HttpResponse.json(toAdmin(post)) : errorResponse(404, "NOT_FOUND", "게시물을 찾을 수 없습니다.");
    }),
    http.post(apiUrl("/api/learn/admin/posts"), async ({ request }) => {
      const url = record(request);
      const body = (await request.json()) as AdminPostInput;
      state.bodies.push({ method: "POST", path: url.pathname, body });
      if (body.kind === "video" && !body.videoUrl?.includes("youtu")) {
        return errorResponse(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", [
          { field: "videoUrl", message: "YouTube 링크만 등록할 수 있습니다." },
        ]);
      }
      const post = mockPost(body.slug ?? "p-1a2b3c4d", { ...body, slug: body.slug ?? "p-1a2b3c4d" });
      state.posts.push(post);
      return HttpResponse.json(toAdmin(post), { status: 201 });
    }),
    http.patch(apiUrl("/api/learn/admin/posts/:id"), async ({ request, params }) => {
      const url = record(request);
      const body = (await request.json()) as Partial<AdminPostInput>;
      state.bodies.push({ method: "PATCH", path: url.pathname, body });
      const post = find(params.id as string);
      if (!post) return errorResponse(404, "NOT_FOUND", "게시물을 찾을 수 없습니다.");
      Object.assign(post, body);
      return HttpResponse.json(toAdmin(post));
    }),
    http.delete(apiUrl("/api/learn/admin/posts/:id"), ({ request, params }) => {
      record(request);
      state.posts = state.posts.filter((post) => post.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(apiUrl("/api/learn/admin/ai-draft"), async ({ request }) => {
      const url = record(request);
      state.bodies.push({ method: "POST", path: url.pathname, body: await request.json() });
      if (options.aiEnabled === false) {
        return errorResponse(503, "LLM_UNAVAILABLE", "AI 기능이 꺼져 있습니다.");
      }
      return HttpResponse.json(state.draft);
    }),
  );
  return state;
}
