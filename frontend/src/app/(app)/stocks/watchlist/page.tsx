import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/ComingSoon";

export const metadata: Metadata = { title: "관심종목" };

export default function WatchlistPage() {
  return <ComingSoon title="관심종목" taskId="12" />;
}
