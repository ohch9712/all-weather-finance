import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingState } from "@/components/common/LoadingState";
import { RecommendationView } from "@/features/allocation/components/RecommendationView";

export const metadata: Metadata = { title: "내 추천 결과" };

export default function AllocationRecommendationPage() {
  return (
    // ?onboarding=1을 읽으므로 Suspense 안에 둔다(useSearchParams).
    <Suspense fallback={<LoadingState rows={5} />}>
      <RecommendationView />
    </Suspense>
  );
}
