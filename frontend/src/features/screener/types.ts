export const FIELD_LABELS = {
  price: "현재가",
  changeRate: "등락률",
  volume: "거래량",
  tradingValue: "거래대금",
  marketCap: "시가총액",
  per: "PER",
  pbr: "PBR",
  roe: "ROE",
  eps: "EPS",
  bps: "BPS",
  foreignRatio: "외국인 보유 비율",
  high52wGapRate: "52주 최고가 대비",
  low52wGapRate: "52주 최저가 대비",
} as const;
export type FilterField = keyof typeof FIELD_LABELS;
export type Op = "gt" | "gte" | "lt" | "lte" | "between";
export const OP_LABELS: Record<Op, string> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "범위",
};
export interface Condition {
  field: FilterField;
  op: Op;
  value: string;
  valueTo: string | null;
}
export interface ScreenFilter {
  markets: ("KOSPI" | "KOSDAQ")[] | null;
  kinds: ("stock" | "etf")[] | null;
  sectors: string[] | null;
  conditions: Condition[];
  sort: { field: FilterField; direction: "asc" | "desc" } | null;
  limit: number;
}
export interface ParsedScreen {
  filter: ScreenFilter;
  explanation: string;
  unsupported: { text: string; reason: string }[];
  chips: { label: string }[];
}
export interface ScreenItem {
  code: string;
  name: string;
  market: string | null;
  sector: string | null;
  kind: "stock" | "etf" | null;
  price: string | null;
  changeRate: number | null;
  marketCap: number | null;
  per: string | null;
  pbr: string | null;
  roe: string | null;
  tradingValue: number | null;
}
export interface ScreenResult {
  asOf: string | null;
  source: string | null;
  total: number;
  excludedForMissingData: number;
  items: ScreenItem[];
}
export interface SavedScreen {
  id: string;
  name: string;
  queryText: string | null;
  filter: ScreenFilter;
  createdAt: string;
}
export interface BrokerCondition {
  seq: string;
  name: string;
}
export interface Connection {
  id: string;
  provider: string;
  label: string;
  status: string;
}
