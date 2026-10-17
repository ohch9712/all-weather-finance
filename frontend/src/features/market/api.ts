import { apiFetch } from "@/lib/api-client";
import type { Connection, ConnectionInput, SnapshotStatus } from "./types";

export const marketApi = {
  connections: () => apiFetch<{ items: Connection[] }>("/api/market/connections"),
  snapshotStatus: () => apiFetch<SnapshotStatus>("/api/market/snapshot/status"),
  egressIp: () => apiFetch<{ ip: string | null }>("/api/market/connections/egress-ip", { timeoutMs: 15_000 }),
  create: (data: ConnectionInput) => apiFetch<Connection>("/api/market/connections", { method: "POST", body: JSON.stringify(data) }),
  verify: (id: string) => apiFetch<Connection>(`/api/market/connections/${id}/verify`, { method: "POST", timeoutMs: 60_000 }),
  remove: (id: string) => apiFetch<void>(`/api/market/connections/${id}`, { method: "DELETE" }),
};
