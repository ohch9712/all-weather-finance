"use client";

import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "./api";

export const dashboardSummaryKey = ["dashboard", "summary"] as const;

/** 홈 카드 데이터. 다른 화면에서 바꾼 내용이 바로 보이게 홈에 올 때마다 다시 불러온다. */
export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardSummaryKey,
    queryFn: dashboardApi.summary,
    staleTime: 0,
  });
}
