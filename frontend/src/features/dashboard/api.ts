import { apiFetch } from "@/lib/api-client";
import type { DashboardSummary } from "./types";

// 홈은 다른 모듈 데이터를 이 요청 하나로 받는다(스펙 16 3절).
export const dashboardApi = {
  summary: () => apiFetch<DashboardSummary>("/api/dashboard/summary"),
};
