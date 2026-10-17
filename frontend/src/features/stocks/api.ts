import { apiFetch } from "@/lib/api-client";
import type { CandleList, StockDetail, StockSearchResult } from "./types";

export const stocksApi = {
  search: (q: string, signal?: AbortSignal) =>
    apiFetch<StockSearchResult>(`/api/market/stocks?${new URLSearchParams({ q, limit: "20" })}`, { signal }),
  detail: (code: string) => apiFetch<StockDetail>(`/api/market/stocks/${encodeURIComponent(code)}`),
  candles: (code: string, from: string, to: string) =>
    apiFetch<CandleList>(`/api/market/stocks/${encodeURIComponent(code)}/candles?${new URLSearchParams({ from, to })}`),
};
