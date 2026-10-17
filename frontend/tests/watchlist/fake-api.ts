import { HttpResponse, http } from "msw";
import type { StockDetail, StockSummary } from "@/features/stocks/types";
import type { WatchlistItem, WatchlistResponse } from "@/features/watchlist/types";
import { apiUrl, errorResponse, server } from "../utils";

// 08 종목 마스터(테스트용 일부). 숫자는 08 응답처럼 decimal 문자열이다.
export const STOCKS: StockSummary[] = [
  { code: "005930", name: "삼성전자", market: "KOSPI", sector: "통신 및 방송 장비 제조업", kind: "stock" },
  { code: "000660", name: "SK하이닉스", market: "KOSPI", sector: "반도체 제조업", kind: "stock" },
  { code: "035420", name: "NAVER", market: "KOSPI", sector: "포털", kind: "stock" },
  { code: "069500", name: "KODEX 200", market: "KOSPI", sector: null, kind: "etf" },
  { code: "005935", name: "삼성전자우", market: "KOSPI", sector: "통신 및 방송 장비 제조업", kind: "stock" },
];

export function stockDetail(code: string, overrides: Partial<StockDetail> = {}): StockDetail {
  const stock = STOCKS.find((item) => item.code === code) ?? STOCKS[0];
  const etf = stock.kind === "etf";
  return {
    ...stock,
    snapshot: {
      asOf: "2026-10-16",
      price: etf ? "47140.0000" : "102800.0000",
      changeRate: etf ? 2.77 : -1.21,
      marketCap: etf ? 927900000000 : 1275600000000,
      per: etf ? null : "31.86",
      pbr: etf ? null : "0.74",
      roe: etf ? null : "-1.52",
      eps: etf ? null : "1221.00",
      bps: etf ? null : "33432.00",
      foreignRatio: etf ? null : "41.48",
      high52w: etf ? "56568.0000" : "123360.0000",
      low52w: etf ? "37712.0000" : "82240.0000",
      tradingValue: etf ? 293421940060 : 218910544000,
      volume: 6307654,
    },
    quote: {
      code: stock.code,
      price: etf ? "47140" : "102800",
      change: etf ? "1270" : "-1260",
      changeRate: etf ? 2.77 : -1.21,
      volume: 6307654,
      asOf: "2026-10-16T06:30:00Z",
      source: "mock",
    },
    source: "mock",
    ...overrides,
  };
}

let nextId = 1;

export function watchlistItem(code: string, overrides: Partial<WatchlistItem> = {}): WatchlistItem {
  const stock = STOCKS.find((item) => item.code === code) ?? STOCKS[0];
  const etf = stock.kind === "etf";
  return {
    id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    code: stock.code,
    name: stock.name,
    market: stock.market,
    sector: stock.sector,
    kind: stock.kind,
    groupName: "기본",
    memo: null,
    sortOrder: 0,
    quote: { price: etf ? "47140" : "102800", change: "0", changeRate: etf ? 2.77 : -1.21, asOf: "2026-10-16T06:30:00Z" },
    metrics: etf ? { per: null, pbr: null, marketCap: 927900000000 } : { per: "31.86", pbr: "0.74", marketCap: 1275600000000 },
    source: "mock",
    createdAt: "2026-10-16T03:21:45Z",
    ...overrides,
  };
}

export interface FakeApi {
  items: WatchlistItem[];
  searches: string[];
  candleRequests: { code: string; from: string; to: string }[];
  posts: unknown[];
  patches: { id: string; body: unknown }[];
  orders: unknown[];
  deletes: string[];
}

function sortItems(items: WatchlistItem[]) {
  return [...items].sort(
    (a, b) =>
      (a.groupName < b.groupName ? -1 : a.groupName > b.groupName ? 1 : 0) ||
      a.sortOrder - b.sortOrder ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/** 관심종목·시장 API를 메모리 상태로 흉내 낸다. */
export function mockApi(
  initial: WatchlistItem[] = [],
  options: { details?: Record<string, StockDetail>; candles?: (code: string) => { date: string; close: string }[] } = {},
): FakeApi {
  const api: FakeApi = { items: [...initial], searches: [], candleRequests: [], posts: [], patches: [], orders: [], deletes: [] };
  const response = (): WatchlistResponse => {
    const items = sortItems(api.items);
    return { items, groups: [...new Set(items.map((item) => item.groupName))], source: "mock" };
  };
  server.use(
    http.get(apiUrl("/api/watchlist"), () => HttpResponse.json(response())),
    http.post(apiUrl("/api/watchlist"), async ({ request }) => {
      const body = (await request.json()) as { code: string; groupName?: string; memo?: string | null };
      api.posts.push(body);
      if (!STOCKS.some((stock) => stock.code === body.code)) {
        return errorResponse(404, "NOT_FOUND", "종목을 찾을 수 없습니다.");
      }
      if (api.items.some((item) => item.code === body.code)) {
        return errorResponse(409, "CONFLICT", "이미 관심종목에 있습니다.");
      }
      const groupName = body.groupName ?? "기본";
      const sortOrder = api.items.filter((item) => item.groupName === groupName).length;
      const item = watchlistItem(body.code, { groupName, memo: body.memo ?? null, sortOrder });
      api.items.push(item);
      return HttpResponse.json(item, { status: 201 });
    }),
    http.put(apiUrl("/api/watchlist/order"), async ({ request }) => {
      const body = (await request.json()) as { groupName: string; ids: string[] };
      api.orders.push(body);
      body.ids.forEach((id, index) => {
        const item = api.items.find((entry) => entry.id === id);
        if (item) item.sortOrder = index;
      });
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch(apiUrl("/api/watchlist/:id"), async ({ params, request }) => {
      const body = (await request.json()) as { groupName?: string; memo?: string | null };
      const id = String(params.id);
      api.patches.push({ id, body });
      const item = api.items.find((entry) => entry.id === id);
      if (!item) return errorResponse(404, "NOT_FOUND", "관심종목을 찾을 수 없습니다.");
      if (body.groupName !== undefined && body.groupName !== item.groupName) {
        item.sortOrder = api.items.filter((entry) => entry.groupName === body.groupName).length;
        item.groupName = body.groupName;
      }
      if (body.memo !== undefined) item.memo = body.memo;
      return HttpResponse.json(item);
    }),
    http.delete(apiUrl("/api/watchlist/:id"), ({ params }) => {
      const id = String(params.id);
      api.deletes.push(id);
      const before = api.items.length;
      api.items = api.items.filter((item) => item.id !== id);
      if (api.items.length === before) return errorResponse(404, "NOT_FOUND", "관심종목을 찾을 수 없습니다.");
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(apiUrl("/api/market/stocks"), ({ request }) => {
      const q = new URL(request.url).searchParams.get("q") ?? "";
      api.searches.push(q);
      const items = STOCKS.filter((stock) => stock.code.includes(q) || stock.name.includes(q));
      return HttpResponse.json({ items, source: "mock" });
    }),
    http.get(apiUrl("/api/market/stocks/:code/candles"), ({ params, request }) => {
      const url = new URL(request.url);
      const code = String(params.code);
      api.candleRequests.push({ code, from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "" });
      const rows = options.candles?.(code) ?? [
        { date: "2026-10-15", close: "103000" },
        { date: "2026-10-16", close: "102800" },
      ];
      return HttpResponse.json({
        items: rows.map((row) => ({ ...row, open: row.close, high: row.close, low: row.close, volume: 100 })),
        source: "mock",
      });
    }),
    http.get(apiUrl("/api/market/stocks/:code"), ({ params }) => {
      const code = String(params.code);
      const detail = options.details?.[code] ?? (STOCKS.some((stock) => stock.code === code) ? stockDetail(code) : null);
      return detail ? HttpResponse.json(detail) : errorResponse(404, "NOT_FOUND", "종목을 찾을 수 없습니다.");
    }),
  );
  return api;
}
