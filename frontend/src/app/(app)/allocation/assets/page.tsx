import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingState } from "@/components/common/LoadingState";
import { AssetsManager } from "@/features/allocation/components/AssetsManager";

export const metadata: Metadata = { title: "보유 자산" };

export default function AllocationAssetsPage() {
  return (
    // ?onboarding=1을 읽으므로 Suspense 안에 둔다(useSearchParams).
    <Suspense fallback={<LoadingState rows={4} />}>
      <AssetsManager />
    </Suspense>
  );
}
