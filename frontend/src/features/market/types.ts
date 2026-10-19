export type Provider = "mock" | "kiwoom" | "toss";
export interface Connection {
  id: string;
  provider: Provider;
  environment: "mock" | "real";
  label: string;
  appKeyMasked: string | null;
  accountNoMasked: string | null;
  status: "unverified" | "active" | "error";
  autoSync: boolean;
  lastAutoSyncAt: string | null;
  lastAutoSyncStatus: "ok" | "partial" | "failed" | null;
  lastAutoSyncErrorCode: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
}
export interface ConnectionInput {
  provider: Provider;
  environment: "mock" | "real";
  label: string;
  appKey: string;
  appSecret: string;
  accountNo?: string;
}
export interface TossAccount {
  accountSeq: string;
  accountType: string;
  accountNoLast4: string;
}
export interface SnapshotStatus {
  asOf: string | null;
  count: number;
  source: Provider | null;
}

export interface StockSummary {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | "KONEX" | "NASDAQ" | "NYSE" | "AMEX" | "OTHER";
  sector: string | null;
  kind: "stock" | "etf";
}
