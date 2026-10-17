// 08 시장 데이터 API 응답 타입(백엔드 camelCase 그대로). 숫자 문자열은 decimal이다.

export type MarketProvider = "mock" | "kiwoom" | "toss";
export type StockKind = "stock" | "etf";

export interface StockSummary {
  code: string;
  name: string;
  market: string;
  sector: string | null;
  kind: StockKind;
}

export interface StockSearchResult {
  items: StockSummary[];
  source: MarketProvider;
}

export interface StockSnapshot {
  asOf: string;
  price: string;
  changeRate: number | null;
  marketCap: number | null;
  per: string | null;
  pbr: string | null;
  roe: string | null;
  eps: string | null;
  bps: string | null;
  foreignRatio: string | null;
  high52w: string | null;
  low52w: string | null;
  tradingValue: number | null;
  volume: number | null;
}

export interface StockQuote {
  code: string;
  price: string;
  change: string | null;
  changeRate: number | null;
  volume: number | null;
  asOf: string;
  source: MarketProvider;
}

export interface StockDetail extends StockSummary {
  snapshot: StockSnapshot | null;
  quote: StockQuote | null;
  source: MarketProvider;
}

export interface Candle {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number;
}

export interface CandleList {
  items: Candle[];
  source: MarketProvider;
}

export type ChartPeriod = "1m" | "3m" | "6m" | "1y";
