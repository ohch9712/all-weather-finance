import { Suspense } from "react";
import { LoadingState } from "@/components/common/LoadingState";
import { EstatePage } from "@/features/estate/components/EstatePage";

export default function Page() {
  return <Suspense fallback={<LoadingState />}><EstatePage /></Suspense>;
}
