import { apiFetch } from "@/lib/api-client";
import type {
  BrokerCondition,
  Connection,
  ParsedScreen,
  SavedScreen,
  ScreenFilter,
  ScreenResult,
} from "./types";

export const parseQuery = (query: string) =>
  apiFetch<ParsedScreen>("/api/screener/parse", {
    method: "POST",
    body: JSON.stringify({ query }),
    timeoutMs: 360000,
  });
export const runScreen = (filter: ScreenFilter) =>
  apiFetch<ScreenResult>("/api/screener/run", {
    method: "POST",
    body: JSON.stringify({ filter }),
  });
export const listSaved = () =>
  apiFetch<{ items: SavedScreen[] }>("/api/screener/saved");
export const saveScreen = (data: {
  name: string;
  queryText: string | null;
  filter: ScreenFilter;
}) =>
  apiFetch<SavedScreen>("/api/screener/saved", {
    method: "POST",
    body: JSON.stringify(data),
  });
export const deleteSaved = (id: string) =>
  apiFetch<void>(`/api/screener/saved/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
export const listConnections = () =>
  apiFetch<{ items: Connection[] }>("/api/market/connections");
export const listBrokerConditions = (connectionId: string | null) =>
  apiFetch<{ items: BrokerCondition[]; source: string }>(
    "/api/screener/broker-conditions" +
      (connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : ""),
  );
export const runBrokerCondition = (data: {
  connectionId: string | null;
  seq: string;
}) =>
  apiFetch<ScreenResult>("/api/screener/broker-conditions/run", {
    method: "POST",
    body: JSON.stringify(data),
  });
export const addWatchlist = (code: string) =>
  apiFetch<unknown>("/api/watchlist", {
    method: "POST",
    body: JSON.stringify({ code, groupName: "기본", memo: null }),
  });
// 검색 범위의 그룹 선택지. 12의 관심종목 목록 응답에서 groups만 쓴다.
export const listWatchlistGroups = () =>
  apiFetch<{ groups: string[] }>("/api/watchlist");
