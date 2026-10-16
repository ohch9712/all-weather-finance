import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/common/LoadingState";
import { GlossaryPage } from "@/features/learn/components/GlossaryPage";

export const metadata: Metadata = { title: "주식 용어" };

export default function Page() {
  // 초성·검색어를 URL 쿼리에서 읽으므로(useSearchParams) Suspense 안에 둔다.
  return (
    <Suspense fallback={<LoadingState rows={5} />}>
      <GlossaryPage />
    </Suspense>
  );
}
