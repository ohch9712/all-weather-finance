import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/ComingSoon";

export const metadata: Metadata = { title: "종목 상세" };

export default function StockDetailPage() {
  return <ComingSoon title="종목 상세" taskId="12" />;
}
