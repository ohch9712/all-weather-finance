import { apiFetch } from "@/lib/api-client";
import type { CaseEnvelope, Health, LifeExpectancyInfo, ParentRole, SuccessionInput, SuccessionResult } from "./types";

const base = "/api/succession";

export const successionApi = {
  getCase: () => apiFetch<CaseEnvelope>(`${base}/case`),
  saveCase: (input: SuccessionInput, sensitiveConsent: boolean) =>
    apiFetch<CaseEnvelope>(`${base}/case`, { method: "PUT", body: JSON.stringify({ case: input, sensitiveConsent }) }),
  deleteCase: () => apiFetch<void>(`${base}/case`, { method: "DELETE" }),
  withdrawConsent: () => apiFetch<CaseEnvelope>(`${base}/case/sensitive`, { method: "DELETE" }),
  lifeExpectancy: (role: ParentRole, age: number, health: Health | null) => {
    const query = new URLSearchParams({ role, age: String(age) });
    if (health) query.set("health", health);
    return apiFetch<LifeExpectancyInfo>(`${base}/life-expectancy?${query}`);
  },
  plans: (input: SuccessionInput) =>
    apiFetch<SuccessionResult>(`${base}/plans`, { method: "POST", body: JSON.stringify(input) }),
};
