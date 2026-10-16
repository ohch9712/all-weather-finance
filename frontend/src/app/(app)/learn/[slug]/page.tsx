import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/ComingSoon";

export const metadata: Metadata = { title: "학습 글" };

export default function LearnPostPage() {
  return <ComingSoon title="학습 글" taskId="07" />;
}
