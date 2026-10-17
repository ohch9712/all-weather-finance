import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/common/LoadingState";
import { ChatPage } from "@/features/chat/components/ChatPage";

export const metadata: Metadata = { title: "AI 상담" };

export default function Page() {
  // 대화 id를 URL 쿼리(?c=)에서 읽으므로(useSearchParams) Suspense 안에 둔다.
  return (
    <Suspense fallback={<LoadingState rows={4} />}>
      <ChatPage />
    </Suspense>
  );
}
