import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/ComingSoon";

export const metadata: Metadata = { title: "배우기" };

export default function LearnPage() {
  return <ComingSoon title="배우기" taskId="07" />;
}
