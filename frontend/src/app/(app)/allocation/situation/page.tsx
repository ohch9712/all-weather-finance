import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingState } from "@/components/common/LoadingState";
import { SituationManager } from "@/features/allocation/components/SituationManager";

export const metadata: Metadata = { title: "목표·상황" };

export default function AllocationSituationPage() {
  return (
    // ?onboarding=1을 읽으므로 Suspense 안에 둔다(useSearchParams).
    <Suspense fallback={<LoadingState rows={4} />}>
      <SituationManager />
    </Suspense>
  );
}
