// 관심종목 API 타입(스펙 12 5절, 백엔드 camelCase 그대로)
import type { MarketProvider, StockKind } from "@/features/stocks/types";

export interface WatchlistQuote {
  price: string;
  change: string | null;
  changeRate: number | null;
  asOf: string;
}

export interface WatchlistMetrics {
  per: string | null;
  pbr: string | null;
  marketCap: number | null;
}

export interface WatchlistItem {
  id: string;
  code: string;
  name: string;
  /** 종목 마스터에서 빠진 코드는 null */
  market: string | null;
  sector: string | null;
  kind: StockKind;
  groupName: string;
  memo: string | null;
  sortOrder: number;
  quote: WatchlistQuote | null;
  metrics: WatchlistMetrics | null;
  source: MarketProvider;
  createdAt: string;
}

export interface WatchlistResponse {
  items: WatchlistItem[];
  groups: string[];
  source: MarketProvider;
}

export interface WatchlistCreateInput {
  code: string;
  groupName?: string;
  memo?: string | null;
}

export interface WatchlistPatchInput {
  groupName?: string;
  memo?: string | null;
}

export interface WatchlistOrderInput {
  groupName: string;
  ids: string[];
}
