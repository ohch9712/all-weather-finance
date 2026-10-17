"use client";

import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useConversations, useDeleteConversation } from "../hooks";

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** 지금 보고 있는 대화를 지웠을 때 */
  onDeleted: (id: string) => void;
}

/** 대화 목록: "새 대화", 선택, 삭제(확인). 이전 AI 설정으로 만든 대화에는 배지를 붙인다. */
export function ConversationList({ selectedId, onSelect, onNew, onDeleted }: ConversationListProps) {
  const conversations = useConversations();
  const remove = useDeleteConversation();
  const items = conversations.data?.pages.flatMap((page) => page.items) ?? [];

  async function handleDelete(id: string) {
    try {
      await remove.mutateAsync(id);
      onDeleted(id);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3">
        <Button type="button" variant="outline" className="w-full" onClick={onNew}>
          <Plus aria-hidden="true" />새 대화
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.isPending ? (
          <LoadingState rows={3} />
        ) : conversations.isError ? (
          <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />
        ) : items.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">아직 대화가 없어요.</p>
        ) : (
          <ul className="space-y-1" aria-label="대화 목록">
            {items.map((item) => (
              <li key={item.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={item.id === selectedId ? "true" : undefined}
                  className={cn(
                    "min-w-0 flex-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted",
                    item.id === selectedId && "bg-muted",
                  )}
                >
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {formatDateTime(item.lastMessageAt ?? item.createdAt)}
                    {!item.canContinue && <Badge variant="secondary">이전 AI 설정</Badge>}
                  </span>
                </button>
                <ConfirmDialog
                  title="대화를 지울까요?"
                  description={`"${item.title}" 대화와 기록이 모두 지워지고 되돌릴 수 없어요.`}
                  confirmLabel="삭제"
                  destructive
                  onConfirm={() => handleDelete(item.id)}
                  trigger={
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`${item.title} 삭제`}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {conversations.hasNextPage && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            disabled={conversations.isFetchingNextPage}
            onClick={() => void conversations.fetchNextPage()}
          >
            더 보기
          </Button>
        )}
      </div>
    </div>
  );
}
