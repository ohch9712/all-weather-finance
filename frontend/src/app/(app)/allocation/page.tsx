import type { Metadata } from "next";
import { AllocationReportView } from "@/features/allocation/components/AllocationReportView";

export const metadata: Metadata = { title: "자산배분" };

export default function AllocationPage() {
  return <AllocationReportView />;
}
