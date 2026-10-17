import type { Page } from "@/types/api";

export type AccountKind = "card" | "bank";
export interface ConnectorProvider { key: "codef" | "mydata"; available: boolean; environment?: "sandbox" | "development" | "production"; note: string }
export interface Organization { code: string; name: string }
export interface ConnectorAccount { id: string; provider: "codef"; kind: AccountKind; organization: string; organizationName: string; label: string; createdAt: string }
export interface AccountInput { provider: "codef"; kind: AccountKind; organization: string; label: string; loginId: string; password: string; consent: boolean }
export interface ImportSummary { inserted: number; skippedDuplicates: number; failed: number; errors: unknown[] }
export interface HoldingSummary { created: number; updated: number; removed: number; skipped: unknown[]; syncedAt: string }
export interface ConnectorSync { id: string; accountId: string; kind: "card_approvals" | "bank_balances"; status: "running" | "succeeded" | "failed"; rangeStart: string | null; rangeEnd: string | null; startedAt: string; finishedAt: string | null; summary: ImportSummary | HoldingSummary | null; errorCode: string | null }
export interface SyncInput { accountId: string; from?: string; to?: string }
export type SyncPage = Page<ConnectorSync>;
