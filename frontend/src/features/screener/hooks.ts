"use client";
import { useState } from "react";
import type { ScreenResult } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

export const useParseQuery = () => useMutation({ mutationFn: api.parseQuery });
export function useRunScreen() {
  const [result, setResult] = useState<ScreenResult>();
  const mutation = useMutation({
    mutationFn: api.runScreen,
    onSuccess: setResult,
  });
  return {
    ...mutation,
    // 재정렬 중에도 마지막 결과를 유지해 표와 그 안의 표시 상태가 사라지지 않게 한다.
    data: result,
    reset: () => {
      setResult(undefined);
      mutation.reset();
    },
  };
}
export const useSavedScreens = () =>
  useQuery({ queryKey: ["screener", "saved"], queryFn: api.listSaved });
export function useSaveScreen() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.saveScreen,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["screener", "saved"] }),
  });
}
export function useDeleteSaved() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.deleteSaved,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["screener", "saved"] }),
  });
}
export const useConnections = (enabled: boolean) =>
  useQuery({
    queryKey: ["screener", "connections"],
    queryFn: api.listConnections,
    enabled,
  });
export const useBrokerConditions = (
  connectionId: string | null,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ["screener", "broker", connectionId],
    queryFn: () => api.listBrokerConditions(connectionId),
    enabled,
  });
export const useRunBrokerCondition = () =>
  useMutation({ mutationFn: api.runBrokerCondition });
export function useAddWatchlist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.addWatchlist,
    onSuccess: () => client.invalidateQueries({ queryKey: ["watchlist"] }),
  });
}
