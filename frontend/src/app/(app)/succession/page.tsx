import { Suspense } from "react";
import { LoadingState } from "@/components/common/LoadingState";
import { SuccessionPage } from "@/features/succession/components/SuccessionPage";

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SuccessionPage />
    </Suspense>
  );
}
