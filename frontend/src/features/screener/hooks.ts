"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

export const useParseQuery = () => useMutation({ mutationFn: api.parseQuery });
export const useRunScreen = () => useMutation({ mutationFn: api.runScreen });
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
