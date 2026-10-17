import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/common/LoadingState";
import { LedgerPage } from "@/features/ledger/components/LedgerPage";

export const metadata: Metadata = { title: "가계부" };

export default function Page() {
  // 필터를 URL 쿼리에서 읽으므로(useSearchParams) Suspense 안에 둔다.
  return (
    <Suspense fallback={<LoadingState rows={4} />}>
      <LedgerPage />
    </Suspense>
  );
}
