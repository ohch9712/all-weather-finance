import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/ComingSoon";

export const metadata: Metadata = { title: "학습 콘텐츠 관리" };

export default function AdminLearnPage() {
  return <ComingSoon title="학습 콘텐츠 관리" taskId="07" />;
}
