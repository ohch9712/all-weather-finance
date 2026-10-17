import { Suspense } from "react";
import { LedgerImportReview } from "@/features/ledger/components/LedgerImportReview";

export default function Page() {
  return <Suspense fallback={<p role="status">가져온 내역을 불러오고 있습니다…</p>}><LedgerImportReview /></Suspense>;
}
