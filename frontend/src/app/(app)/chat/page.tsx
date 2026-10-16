import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/ComingSoon";

export const metadata: Metadata = { title: "AI 상담" };

export default function ChatPage() {
  return <ComingSoon title="AI 상담" taskId="09" />;
}
