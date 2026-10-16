export type Currency = "KRW" | "USD";
export type Market = "KRX" | "US" | "OTHER";
export type Kind = "plan" | "review" | "memo";
export type Emotion = "confident" | "calm" | "anxious" | "impulsive" | "greedy" | "fearful" | "regret";
export interface TradeInput {
  tradedOn: string; tradedTime: string | null; market: Market; symbolCode: string; symbolName: string;
  side: "buy" | "sell"; quantity: string; price: string; currency: Currency; fee: string; tax: string;
  broker: "kiwoom" | "toss" | "other" | null; accountLabel: string | null;
}
export type TradePatch = Partial<TradeInput>;
export type SaveTradeRequest = { id?: undefined; data: TradeInput } | { id: string; data: TradePatch };
export interface Trade extends TradeInput {
  id: string; tradedAt: string; timeKnown: boolean; source: "manual" | "import" | "kiwoom" | "toss";
  createdAt: string; updatedAt: string;
}
export interface NoteInput { tradeId: string | null; symbolCode: string | null; notedOn: string; kind: Kind; content: string; tags: string[]; emotion: Emotion | null }
export interface Note extends NoteInput { id: string; createdAt: string; updatedAt: string }
export interface TradeDetail { trade: Trade; realizedPnl: string | null; oversold: boolean; notes: Note[] }
export interface Position {
  market: Market; symbolCode: string; symbolName: string; currency: Currency; quantity: string; avgCost: string;
  costBasis: string; realizedPnl: string; firstTradedOn: string; lastTradedOn: string; tradeCount: number; hasOversold: boolean;
}
export interface Performance { tradeId: string; symbolName: string; realizedPnl: string; tradedOn: string }
export interface CurrencyStats {
  currency: Currency; realizedPnl: string; winCount: number; lossCount: number; winRate: number | null; sellCount: number;
  avgWin: string | null; avgLoss: string | null; bestTrade: Performance | null; worstTrade: Performance | null;
}
export interface TradeStats {
  byCurrency: CurrencyStats[];
  monthly: { month: string; currency: Currency; realizedPnl: string }[];
  daily: { date: string; currency: Currency; realizedPnl: string }[];
  bySymbol: { symbolCode: string; symbolName: string; currency: Currency; realizedPnl: string; sellCount: number }[];
}
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
export type Filters = { from?: string; to?: string; symbol?: string; side?: string; kind?: string; tradeId?: string; page?: number; pageSize?: number };
