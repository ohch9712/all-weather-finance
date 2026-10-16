import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/ComingSoon";

export const metadata: Metadata = { title: "가계부" };

export default function LedgerPage() {
  return <ComingSoon title="가계부" taskId="03" />;
}
