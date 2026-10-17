"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { stocksApi } from "./api";
import type { ChartPeriod } from "./types";
import { periodRange } from "./utils";

const root = ["stocks"] as const;

export const SEARCH_DEBOUNCE_MS = 300;

/** 입력이 `delay` 동안 멈춘 뒤의 값 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useStockSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: [...root, "search", q],
    queryFn: ({ signal }) => stocksApi.search(q, signal),
    enabled: q.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useStockDetail(code: string) {
  return useQuery({ queryKey: [...root, "detail", code], queryFn: () => stocksApi.detail(code) });
}

export function useCandles(code: string, period: ChartPeriod, enabled = true) {
  const { from, to } = periodRange(period);
  return useQuery({
    queryKey: [...root, "candles", code, from, to],
    queryFn: () => stocksApi.candles(code, from, to),
    enabled,
    placeholderData: keepPreviousData,
  });
}
