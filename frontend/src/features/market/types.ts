export type Provider = "mock" | "kiwoom" | "toss";
export interface Connection {
  id: string;
  provider: Provider;
  environment: "mock" | "real";
  label: string;
  appKeyMasked: string | null;
  accountNoMasked: string | null;
  status: "unverified" | "active" | "error";
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
export interface SnapshotStatus {
  asOf: string | null;
  count: number;
  source: Provider | null;
}
