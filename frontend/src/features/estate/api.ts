import { apiFetch } from "@/lib/api-client";
import type { Comparison, DeductionStatus, Gift, Member, Payload, Plan, Prefill, TaxResult } from "./types";

const base = "/api/estate";
const write = <T>(path: string, body: Payload, method = "POST") => apiFetch<T>(base + path, { method, body: JSON.stringify(body) });
export const estateApi = {
  members: () => apiFetch<{ items: Member[] }>(base + "/members"),
  saveMember: (data: Payload, id?: string) => write<Member>(id ? `/members/${id}` : "/members", data, id ? "PATCH" : "POST"),
  deleteMember: (id: string) => apiFetch<void>(`${base}/members/${id}`, { method: "DELETE" }),
  gifts: (recipientId: string) => apiFetch<{ items: Gift[] }>(`${base}/gifts?recipientId=${encodeURIComponent(recipientId)}`),
  saveGift: (data: Payload, id?: string) => write<Gift>(id ? `/gifts/${id}` : "/gifts", data, id ? "PATCH" : "POST"),
  deleteGift: (id: string) => apiFetch<void>(`${base}/gifts/${id}`, { method: "DELETE" }),
  deductions: (id: string) => apiFetch<DeductionStatus>(`${base}/members/${id}/deductions`),
  prefill: () => apiFetch<Prefill>(base + "/inheritance/prefill"),
  giftTax: (data: Payload) => write<TaxResult>("/calc/gift-tax", data),
  inheritanceTax: (data: Payload) => write<TaxResult>("/calc/inheritance-tax", data),
  giftPlan: (data: Payload) => write<Plan>("/simulate/gift-plan", data),
  compare: (data: Payload) => write<Comparison>("/compare", data),
};
