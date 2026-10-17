"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { watchlistApi } from "./api";
import type { WatchlistCreateInput, WatchlistOrderInput, WatchlistPatchInput, WatchlistResponse } from "./types";
import { WATCHLIST_REFETCH_MS, applyOrder } from "./utils";

export const watchlistKey = ["watchlist", "list"] as const;

/**
 * 내 관심종목. `poll`이면 화면이 보이는 동안 30초마다 다시 불러온다.
 * 탭이 숨으면 TanStack Query가 주기 조회를 멈춘다(`refetchIntervalInBackground` 기본값 false).
 */
export function useWatchlist({ poll = false }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: watchlistKey,
    queryFn: watchlistApi.list,
    refetchInterval: poll ? WATCHLIST_REFETCH_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function useWatchlistMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: watchlistKey });

  const add = useMutation({
    mutationFn: (data: WatchlistCreateInput) => watchlistApi.add(data),
    onSettled: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: WatchlistPatchInput }) => watchlistApi.update(id, data),
    onSettled: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (data: WatchlistOrderInput) => watchlistApi.reorder(data),
    onMutate: async (data) => {
      await client.cancelQueries({ queryKey: watchlistKey });
      const previous = client.getQueryData<WatchlistResponse>(watchlistKey);
      if (previous) {
        client.setQueryData<WatchlistResponse>(watchlistKey, {
          ...previous,
          items: applyOrder(previous.items, data.groupName, data.ids),
        });
      }
      return { previous };
    },
    onError: (_error, _data, context) => {
      if (context?.previous) client.setQueryData(watchlistKey, context.previous);
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => watchlistApi.remove(id),
    onSettled: invalidate,
  });

  /** 그룹 이름 변경 = 그 그룹 항목들을 순서대로 PATCH(스펙 12 7.1) */
  const renameGroup = useMutation({
    mutationFn: async ({ ids, groupName }: { ids: string[]; groupName: string }) => {
      for (const id of ids) {
        await watchlistApi.update(id, { groupName });
      }
    },
    onSettled: invalidate,
  });

  return { add, update, reorder, remove, renameGroup };
}
