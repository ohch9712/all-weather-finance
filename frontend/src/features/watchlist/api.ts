import { apiFetch } from "@/lib/api-client";
import type {
  WatchlistCreateInput,
  WatchlistItem,
  WatchlistOrderInput,
  WatchlistPatchInput,
  WatchlistResponse,
} from "./types";

export const watchlistApi = {
  list: () => apiFetch<WatchlistResponse>("/api/watchlist"),
  add: (data: WatchlistCreateInput) =>
    apiFetch<WatchlistItem>("/api/watchlist", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: WatchlistPatchInput) =>
    apiFetch<WatchlistItem>(`/api/watchlist/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  reorder: (data: WatchlistOrderInput) =>
    apiFetch<void>("/api/watchlist/order", { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) => apiFetch<void>(`/api/watchlist/${id}`, { method: "DELETE" }),
};
