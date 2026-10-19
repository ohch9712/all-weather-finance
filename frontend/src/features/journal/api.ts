import { apiFetch } from "@/lib/api-client";
import type { BrokerConnection, SyncInput, SyncResult, SyncStatusItem, CostEstimate, CostEstimateInput, CostRates, CostSettings, Filters, Note, NoteInput, Page, Position, Trade, TradeDetail, SaveTradeRequest, TradeStats } from "./types";

function query(filters: Filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== "") params.set(key, String(value)); });
  return params.toString();
}
export const getTrades = (filters: Filters) => apiFetch<Page<Trade>>(`/api/journal/trades?${query(filters)}`);
export const getTrade = (id: string) => apiFetch<TradeDetail>(`/api/journal/trades/${id}`);
export const saveTrade = ({ id, data }: SaveTradeRequest) => apiFetch<Trade>(`/api/journal/trades${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
export const deleteTrade = (id: string) => apiFetch<void>(`/api/journal/trades/${id}`, { method: "DELETE" });
export const getPositions = (includeClosed: boolean) => apiFetch<{ items: Position[] }>(`/api/journal/positions?includeClosed=${includeClosed}`);
export const getStats = (filters: Filters) => apiFetch<TradeStats>(`/api/journal/stats?${query(filters)}`);
export const getNotes = (filters: Filters) => apiFetch<Page<Note>>(`/api/journal/notes?${query(filters)}`);
export const saveNote = ({ id, data }: { id?: string; data: NoteInput }) => apiFetch<Note>(`/api/journal/notes${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
export const deleteNote = (id: string) => apiFetch<void>(`/api/journal/notes/${id}`, { method: "DELETE" });

export const getCostSettings = () => apiFetch<CostSettings>("/api/journal/cost-settings");
export const saveCostSettings = (data: CostRates) => apiFetch<CostSettings>("/api/journal/cost-settings", { method: "PUT", body: JSON.stringify(data) });
export const resetCostSettings = () => apiFetch<CostSettings>("/api/journal/cost-settings", { method: "DELETE" });
export const getCostEstimate = (data: CostEstimateInput) => apiFetch<CostEstimate>(`/api/journal/cost-estimate?${new URLSearchParams({ ...data })}`);

export const getConnections = () => apiFetch<{ items: BrokerConnection[] }>("/api/market/connections");
export const getSyncStatus = () => apiFetch<{ items: SyncStatusItem[] }>("/api/journal/sync/status");
// 키움은 하루·매수/매도마다 한 번씩 초당 4회로 불러 30일이면 15초가 넘으므로 기본 10초 대신 120초를 기다린다(스펙 11 9절).
export const syncTrades = (data: SyncInput) => apiFetch<SyncResult>("/api/journal/sync", { method: "POST", body: JSON.stringify(data), timeoutMs: 120_000 });
