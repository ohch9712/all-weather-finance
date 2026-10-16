import { TradeDetailPage } from "@/features/journal/components/TradeDetailPage";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TradeDetailPage id={id} />;
}
