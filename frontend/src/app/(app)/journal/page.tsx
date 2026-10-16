import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/ComingSoon";

export const metadata: Metadata = { title: "매매일지" };

export default function JournalPage() {
  return <ComingSoon title="매매일지" taskId="05" />;
}
