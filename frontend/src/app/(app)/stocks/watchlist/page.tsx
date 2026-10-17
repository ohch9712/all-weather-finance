import type { Metadata } from "next";
import { WatchlistPage } from "@/features/watchlist/components/WatchlistPage";

export const metadata: Metadata = { title: "관심종목" };

export default function Page() {
  return <WatchlistPage />;
}
