"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { History } from "lucide-react";
import { AiProviderBadge } from "@/components/common/AiProviderBadge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useConversation } from "../hooks";
import { ChatThread } from "./ChatThread";
import { ConversationList } from "./ConversationList";

/** /chat 화면: 왼쪽(모바일은 Sheet) 대화 목록 + 본문. `?c=<id>`로 대화를 연다. */
export function ChatPage() {
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("c"));
  // 사용자가 다른 대화를 고르거나 새 대화를 열 때만 본문을 새로 그린다(첫 질문으로 대화를 만들 때는 그대로 둔다).
  const [threadKey, setThreadKey] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const detail = useConversation(selectedId);

  function remember(id: string | null) {
    setSelectedId(id);
    window.history.replaceState(null, "", id ? `/chat?c=${id}` : "/chat");
  }

  function open(id: string | null) {
    remember(id);
    setThreadKey((key) => key + 1);
    setListOpen(false);
  }

  const list = (
    <ConversationList
      selectedId={selectedId}
      onSelect={(id) => open(id)}
      onNew={() => open(null)}
      onDeleted={(id) => {
        if (id === selectedId) open(null);
      }}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] min-h-[28rem] gap-4 lg:h-[calc(100dvh-8rem)]">
      <aside className="hidden w-64 shrink-0 overflow-hidden rounded-xl border md:block" aria-label="대화 목록 영역">
        {list}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="대화 목록 열기"
            onClick={() => setListOpen(true)}
          >
            <History aria-hidden="true" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">AI 상담</h1>
            <p className="truncate text-xs text-muted-foreground">
              {selectedId ? (detail.data?.conversation.title ?? "") : "새 대화"}
            </p>
          </div>
          <AiProviderBadge scope="personal" />
        </header>
        <div className="min-h-0 flex-1">
          <ChatThread
            key={threadKey}
            conversationId={selectedId}
            onConversationCreated={(id) => remember(id)}
            onNewConversation={() => open(null)}
          />
        </div>
      </section>
      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="left" className="gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>대화 목록</SheetTitle>
            <SheetDescription className="sr-only">이전 대화를 고르거나 새 대화를 시작해요.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">{list}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
