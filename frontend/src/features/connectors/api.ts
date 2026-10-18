import { apiFetch } from "@/lib/api-client";
import type { AccountInput, AccountKind, ConnectorAccount, ConnectorProvider, ConnectorSync, Organization, SyncInput, SyncPage } from "./types";

const root = "/api/connectors";
export const connectorsApi = {
  providers: () => apiFetch<{ items: ConnectorProvider[] }>(`${root}/providers`),
  organizations: (kind: AccountKind) => apiFetch<{ items: Organization[] }>(`${root}/organizations?kind=${kind}`),
  accounts: () => apiFetch<{ items: ConnectorAccount[] }>(`${root}/accounts`),
  create: (data: AccountInput) => apiFetch<ConnectorAccount>(`${root}/accounts`, { method: "POST", body: JSON.stringify(data), timeoutMs: 90_000 }),
  remove: ({ id, localOnly = false }: { id: string; localOnly?: boolean }) => apiFetch<void>(`${root}/accounts/${id}${localOnly ? "?localOnly=true" : ""}`, { method: "DELETE", timeoutMs: 90_000 }),
  sync: (data: SyncInput) => apiFetch<ConnectorSync>(`${root}/sync`, { method: "POST", body: JSON.stringify(data), timeoutMs: 180_000 }),
  syncs: (accountId: string, page = 1) => apiFetch<SyncPage>(`${root}/syncs?accountId=${accountId}&page=${page}`),
};
