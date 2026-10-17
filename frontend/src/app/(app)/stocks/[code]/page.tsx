import type { Metadata } from "next";
import { StockDetailPage } from "@/features/stocks/components/StockDetailPage";

export const metadata: Metadata = { title: "종목 상세" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <StockDetailPage code={code} />;
}
