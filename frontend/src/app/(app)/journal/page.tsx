import { Suspense } from "react";
import { LoadingState } from "@/components/common/LoadingState";
import { JournalPage } from "@/features/journal/components/JournalPage";
export default function Page() {
  return <Suspense fallback={<LoadingState />}><JournalPage /></Suspense>;
}
