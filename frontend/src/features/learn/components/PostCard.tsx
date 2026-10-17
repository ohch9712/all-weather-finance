import Link from "next/link";
import type { PostSummary } from "../types";
import { postHref } from "../utils";
import { BookmarkButton, KindIcon, LevelBadge, ReadMark } from "./PostBits";

/** 카드 그리드 한 칸: 종류 아이콘, 제목, 요약, 난이도, 읽음 체크, 북마크 버튼 */
export function PostCard({ post }: { post: PostSummary }) {
  const heading = post.kind === "glossary" && post.term ? post.term : post.title;
  return (
    <li
      data-testid="post-card"
      className="relative flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/40"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <KindIcon kind={post.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold break-keep">
            <Link href={postHref(post.slug)} className="outline-none after:absolute after:inset-0 after:content-['']">
              {heading}
            </Link>
          </h3>
          {heading !== post.title && <p className="text-xs text-muted-foreground break-keep">{post.title}</p>}
        </div>
        {/* 카드 전체를 덮는 링크 위에 올린다. */}
        <div className="relative z-10 -mt-1 -mr-1">
          <BookmarkButton postId={post.id} title={heading} bookmarked={post.bookmarked} iconOnly />
        </div>
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground break-keep">{post.summary}</p>
      <div className="mt-auto flex items-center gap-2">
        <LevelBadge level={post.level} />
        <ReadMark read={post.read} />
      </div>
    </li>
  );
}
