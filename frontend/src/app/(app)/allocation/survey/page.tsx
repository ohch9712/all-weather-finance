import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingState } from "@/components/common/LoadingState";
import { SurveyWizard } from "@/features/allocation/components/SurveyWizard";

export const metadata: Metadata = { title: "투자성향 진단" };

export default function AllocationSurveyPage() {
  return (
    // ?onboarding=1을 읽으므로 Suspense 안에 둔다(useSearchParams).
    <Suspense fallback={<LoadingState rows={4} />}>
      <SurveyWizard />
    </Suspense>
  );
}
