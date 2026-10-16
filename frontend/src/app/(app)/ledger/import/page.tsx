import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/ComingSoon";

export const metadata: Metadata = { title: "카드 이용내역 가져오기" };

export default function LedgerImportPage() {
  return <ComingSoon title="카드 이용내역 가져오기" taskId="10" />;
}
