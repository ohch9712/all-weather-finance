"use client";

import { BookA, Bookmark, BookmarkCheck, CircleCheck, FileText, PlayCircle, Sparkles, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToggleBookmark } from "../hooks";
import type { PostKind, PostLevel } from "../types";
import { KIND_LABEL, LEVEL_LABEL } from "../utils";

const KIND_ICON: Record<PostKind, LucideIcon> = { article: FileText, video: PlayCircle, glossary: BookA };

export function KindIcon({ kind, className }: { kind: PostKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon role="img" aria-label={KIND_LABEL[kind]} className={cn("size-4 shrink-0", className)} />;
}

export function KindBadge({ kind }: { kind: PostKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <Badge variant="secondary">
      <Icon aria-hidden="true" />
      {KIND_LABEL[kind]}
    </Badge>
  );
}

export function LevelBadge({ level }: { level: PostLevel }) {
  return <Badge variant="outline">{LEVEL_LABEL[level]}</Badge>;
}

export function AiAssistedBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Sparkles aria-hidden="true" />
      AI 도움으로 작성
    </Badge>
  );
}

export function ReadMark({ read, className }: { read: boolean; className?: string }) {
  if (!read) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-primary", className)}>
      <CircleCheck className="size-3.5" aria-hidden="true" />
      읽음
    </span>
  );
}

interface BookmarkButtonProps {
  postId: string;
  title: string;
  bookmarked: boolean;
  /** 아이콘만 보여 준다(카드). 상세 화면은 글자를 함께 보여 준다. */
  iconOnly?: boolean;
}

export function BookmarkButton({ postId, title, bookmarked, iconOnly = false }: BookmarkButtonProps) {
  const toggle = useToggleBookmark();
  const Icon = bookmarked ? BookmarkCheck : Bookmark;
  const label = bookmarked ? "북마크 해제" : "북마크";

  function onClick() {
    toggle.mutate(
      { id: postId, bookmarked: !bookmarked },
      {
        onSuccess: () => toast.success(bookmarked ? "북마크를 해제했어요." : "북마크했어요."),
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  return (
    <Button
      type="button"
      variant={iconOnly ? "ghost" : "outline"}
      size={iconOnly ? "icon" : "sm"}
      aria-pressed={bookmarked}
      aria-label={iconOnly ? `${title} ${label}` : undefined}
      disabled={toggle.isPending}
      onClick={onClick}
      className={cn(bookmarked && "text-primary")}
    >
      <Icon aria-hidden="true" className={cn(bookmarked && "fill-current")} />
      {!iconOnly && label}
    </Button>
  );
}
