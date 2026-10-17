"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Disclaimer } from "@/components/common/Disclaimer";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { useMarkRead, usePost } from "../hooks";
import type { PostDetail, PostSummary } from "../types";
import { KIND_LABEL, LEVEL_LABEL, postHref, tagHref, youtubeEmbedUrl } from "../utils";
import { MarkdownBody } from "./MarkdownBody";
import { AiAssistedBadge, BookmarkButton, KindBadge, KindIcon, LevelBadge, ReadMark } from "./PostBits";

function BackLink() {
  return (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <Link href="/learn">
        <ArrowLeft aria-hidden="true" />
        학습 목록
      </Link>
    </Button>
  );
}

function VideoEmbed({ post }: { post: PostDetail }) {
  if (!post.videoId) return null;
  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl bg-muted">
      <iframe
        src={youtubeEmbedUrl(post.videoId)}
        title={`${post.title} 영상`}
        className="size-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        loading="lazy"
      />
    </div>
  );
}

function RelatedPosts({ posts }: { posts: PostSummary[] }) {
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby="related-heading" className="space-y-3">
      <h2 id="related-heading" className="text-lg font-semibold">
        관련 게시물
      </h2>
      <ul className="grid gap-2 sm:grid-cols-3">
        {posts.map((post) => (
          <li key={post.id}>
            <Link
              href={postHref(post.slug)}
              className="flex h-full min-w-0 items-start gap-2 rounded-lg border p-3 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <KindIcon kind={post.kind} className="mt-0.5 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium break-keep">{post.term ?? post.title}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground break-keep">{post.summary}</span>
                <ReadMark read={post.read} className="mt-1" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PostHeading({ post }: { post: PostDetail }) {
  if (post.kind === "glossary") {
    return (
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">{KIND_LABEL.glossary}</p>
        <h1 className="text-3xl font-bold tracking-tight break-keep sm:text-4xl">{post.term ?? post.title}</h1>
        {post.term && post.title !== post.term && <p className="text-muted-foreground break-keep">{post.title}</p>}
        <p className="rounded-lg bg-muted px-4 py-3 text-base font-medium break-keep">{post.summary}</p>
      </header>
    );
  }
  return (
    <header className="space-y-2">
      <h1 className="text-xl font-semibold tracking-tight break-keep sm:text-2xl">{post.title}</h1>
      <p className="text-muted-foreground break-keep">{post.summary}</p>
    </header>
  );
}

export function PostDetailView({ post }: { post: PostDetail }) {
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={post.kind} />
        <LevelBadge level={post.level} />
        {post.aiAssisted && <AiAssistedBadge />}
        <ReadMark read={post.read} />
        <div className="ml-auto">
          <BookmarkButton postId={post.id} title={post.term ?? post.title} bookmarked={post.bookmarked} />
        </div>
      </div>

      <PostHeading post={post} />
      {post.kind === "video" && <VideoEmbed post={post} />}
      {post.bodyMd.trim() && <MarkdownBody>{post.bodyMd}</MarkdownBody>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
        {post.tags.length > 0 && (
          <ul aria-label="태그" className="flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <li key={tag}>
                <Link
                  href={tagHref(tag)}
                  className="inline-flex rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-muted"
                >
                  #{tag}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {post.publishedAt && <span className="text-xs">{formatDate(post.publishedAt)} 공개</span>}
        <span className="sr-only">난이도 {LEVEL_LABEL[post.level]}</span>
      </div>

      <RelatedPosts posts={post.related} />

      <div className="space-y-1.5">
        <Disclaimer variant="investment" />
        {post.aiAssisted && <Disclaimer variant="ai" />}
      </div>
    </article>
  );
}

/** `/learn/[slug]`: 들어오면 읽음으로 표시한다. */
export function PostDetailPage({ slug }: { slug: string }) {
  const { data: post, isPending, isError, error, refetch } = usePost(slug);
  const markRead = useMarkRead();
  const { mutate } = markRead;
  const markedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!post || markedRef.current === post.id) return;
    markedRef.current = post.id;
    mutate(post.id);
  }, [post, mutate]);

  return (
    <div className="space-y-4">
      <BackLink />
      {isPending ? (
        <LoadingState rows={5} />
      ) : isError ? (
        isApiError(error) && error.status === 404 ? (
          <EmptyState
            title="게시물을 찾을 수 없어요"
            description="주소가 바뀌었거나 비공개로 돌린 게시물이에요."
            action={
              <Button variant="outline" asChild>
                <Link href="/learn">학습 목록으로</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={error} onRetry={() => refetch()} />
        )
      ) : (
        <PostDetailView post={post} />
      )}
    </div>
  );
}
