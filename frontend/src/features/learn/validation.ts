import { z } from "zod";
import { POST_KINDS, POST_LEVELS, type AdminPost, type AdminPostInput } from "./types";
import { LIMITS, joinTags, splitTags } from "./utils";

// 관리자 작성 폼(스펙 07 6.2). 서버 규칙과 같게 먼저 검사하고, 중복·YouTube 주소는 서버 응답으로 표시한다.

const SLUG_OR_EMPTY = /^([a-z0-9]+(-[a-z0-9]+)*)?$/;
const RESERVED_SLUGS = ["glossary"];

export const postFormSchema = z
  .object({
    kind: z.enum(POST_KINDS),
    title: z
      .string()
      .trim()
      .min(1, "제목을 입력해 주세요.")
      .max(LIMITS.title, `제목은 ${LIMITS.title}자까지 쓸 수 있어요.`),
    slug: z
      .string()
      .trim()
      .max(LIMITS.slug, `슬러그는 ${LIMITS.slug}자까지 쓸 수 있어요.`)
      .regex(SLUG_OR_EMPTY, "영문 소문자·숫자·하이픈으로 입력해 주세요.")
      .refine((value) => !RESERVED_SLUGS.includes(value), "쓸 수 없는 슬러그예요."),
    summary: z
      .string()
      .trim()
      .min(1, "요약을 입력해 주세요.")
      .max(LIMITS.summary, `요약은 ${LIMITS.summary}자까지 쓸 수 있어요.`),
    term: z.string().trim().max(LIMITS.term, `용어는 ${LIMITS.term}자까지 쓸 수 있어요.`),
    videoUrl: z.string().trim().max(LIMITS.videoUrl, "주소가 너무 길어요."),
    level: z.enum(POST_LEVELS),
    tags: z
      .string()
      .refine((text) => splitTags(text).length <= LIMITS.tags, `태그는 ${LIMITS.tags}개까지 붙일 수 있어요.`)
      .refine(
        (text) => splitTags(text).every((tag) => tag.length <= LIMITS.tag),
        `태그 하나는 ${LIMITS.tag}자까지 쓸 수 있어요.`,
      ),
    bodyMd: z.string().max(LIMITS.body, `본문은 ${LIMITS.body.toLocaleString("ko-KR")}자까지 쓸 수 있어요.`),
    published: z.boolean(),
    aiAssisted: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.kind === "glossary" && !values.term) {
      ctx.addIssue({ code: "custom", path: ["term"], message: "용어를 입력해 주세요." });
    }
    if (values.kind === "video" && !values.videoUrl) {
      ctx.addIssue({ code: "custom", path: ["videoUrl"], message: "YouTube 링크를 입력해 주세요." });
    }
  });

export type PostFormInput = z.input<typeof postFormSchema>;
export type PostFormOutput = z.output<typeof postFormSchema>;

export const POST_FORM_FIELDS = [
  "kind",
  "title",
  "slug",
  "summary",
  "term",
  "videoUrl",
  "level",
  "tags",
  "bodyMd",
  "published",
  "aiAssisted",
] as const;

export function toFormValues(post?: AdminPost): PostFormInput {
  return {
    kind: post?.kind ?? "article",
    title: post?.title ?? "",
    slug: post?.slug ?? "",
    summary: post?.summary ?? "",
    term: post?.term ?? "",
    videoUrl: post?.videoUrl ?? "",
    level: post?.level ?? "beginner",
    tags: joinTags(post?.tags ?? []),
    bodyMd: post?.bodyMd ?? "",
    published: post?.published ?? false,
    aiAssisted: post?.aiAssisted ?? false,
  };
}

/** 종류에 맞지 않는 칸(용어·영상 주소)은 보내지 않는다. 슬러그를 비우면 서버가 자동으로 만든다. */
export function toPostInput(values: PostFormOutput): AdminPostInput {
  return {
    kind: values.kind,
    slug: values.slug || null,
    title: values.title,
    summary: values.summary,
    bodyMd: values.bodyMd,
    term: values.kind === "glossary" ? values.term : null,
    videoUrl: values.kind === "video" ? values.videoUrl : null,
    level: values.level,
    tags: splitTags(values.tags),
    published: values.published,
    aiAssisted: values.aiAssisted,
  };
}
