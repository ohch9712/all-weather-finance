import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "./api-client";

// 쿼리 키는 `[module, ...]` 배열로 쓴다. 예: ["ai", "status"], ["ledger", "entries", { month }]

/** 4xx는 다시 시도해도 결과가 같으므로 재시도하지 않는다. 네트워크·5xx는 한 번만 다시 시도한다. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
