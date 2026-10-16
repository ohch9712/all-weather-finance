import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/ComingSoon";

export const metadata: Metadata = { title: "보유 자산" };

export default function AllocationAssetsPage() {
  return <ComingSoon title="보유 자산" taskId="02" />;
}
