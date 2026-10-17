"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Maximize2, MessageCircle, Plus } from "lucide-react";
import { AiProviderBadge } from "@/components/common/AiProviderBadge";
import { LoadingState } from "@/components/common/LoadingState";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLatestConversation } from "../hooks";
import { CHAT_OPEN_EVENT, type OpenChatWidgetOptions } from "../widget-events";
import { ChatThread } from "./ChatThread";

function isChatPage(pathname: string) {
  return pathname === "/chat" || pathname.startsWith("/chat/");
}

/**
 * 모든 앱 화면 오른쪽 아래의 챗봇 위젯(스펙 09 9.2). /chat에서는 숨긴다.
 * 열면 최근 대화를 잇고, 최근 대화가 없거나 이어 갈 수 없으면 새 대화를 연다.
 */
export function ChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  /** undefined면 최근 대화를 자동으로 고른다. null이면 새 대화 */
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [threadKey, setThreadKey] = useState(0);
  const [draft, setDraft] = useState("");
  const latest = useLatestConversation(open && selectedId === undefined);

  useEffect(() => {
    function handleOpen(event: Event) {
      const options = (event as CustomEvent<OpenChatWidgetOptions | undefined>).detail;
      setOpen(true);
      if (options?.draft) {
        setDraft(options.draft);
        setThreadKey((key) => key + 1);
      }
    }
    window.addEventListener(CHAT_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(CHAT_OPEN_EVENT, handleOpen);
  }, []);

  if (isChatPage(pathname)) return null;

  const autoId = latest.data?.canContinue ? latest.data.id : null;
  const conversationId = selectedId === undefined ? autoId : selectedId;
  const resolving = selectedId === undefined && latest.isPending;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // 닫으면 다음에 열 때 최근 대화를 다시 고른다.
      setSelectedId(undefined);
      setDraft("");
    }
  }

  function startNew() {
    setSelectedId(null);
    setDraft("");
    setThreadKey((key) => key + 1);
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="AI 상담 열기"
        className="fixed right-4 bottom-4 z-40 size-12 rounded-full shadow-lg"
      >
        <MessageCircle className="size-5" aria-hidden="true" />
      </Button>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
          aria-label="AI 상담"
        >
          <SheetHeader className="gap-2 border-b pr-12">
            <div className="flex items-center gap-2">
              <SheetTitle>AI 상담</SheetTitle>
              <AiProviderBadge scope="personal" compact />
            </div>
            <SheetDescription className="sr-only">자산·가계부·용어를 AI에게 물어봐요.</SheetDescription>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={conversationId ? `/chat?c=${conversationId}` : "/chat"} onClick={() => setOpen(false)}>
                  <Maximize2 aria-hidden="true" />
                  전체 화면으로
                </Link>
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={startNew}>
                <Plus aria-hidden="true" />새 대화
              </Button>
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            {resolving ? (
              <div className="p-4">
                <LoadingState rows={2} />
              </div>
            ) : (
              <ChatThread
                key={threadKey}
                conversationId={conversationId}
                onConversationCreated={(id) => setSelectedId(id)}
                onNewConversation={startNew}
                initialDraft={draft}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
