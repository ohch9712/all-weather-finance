"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api-client";

// GET /api/ai/status(스펙 01 7.10, architecture 9.1.3)

export type AiScope = "general" | "personal";
export type AiProvider = "gemini" | "ollama";
export type AiLocation = "cloud" | "local";
export type AiDisabledReason = "not_configured" | "missing_api_key" | "billing_required";

export interface ScopeStatus {
  enabled: boolean;
  provider: AiProvider | null;
  location: AiLocation | null;
  model: string | null;
  reason: AiDisabledReason | null;
}

export interface AiStatus {
  general: ScopeStatus;
  personal: ScopeStatus;
}

export const AI_STATUS_QUERY_KEY = ["ai", "status"] as const;

export function getAiStatus(): Promise<AiStatus> {
  return apiFetch<AiStatus>("/api/ai/status");
}

export function useAiStatus() {
  return useQuery({
    queryKey: AI_STATUS_QUERY_KEY,
    queryFn: getAiStatus,
    staleTime: 5 * 60 * 1000,
  });
}
