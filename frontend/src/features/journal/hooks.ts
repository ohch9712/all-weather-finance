"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import type { CostEstimateInput, Filters } from "./types";

const root = ["journal"];
export const useTrades = (filters: Filters = {}) => useQuery({ queryKey: [...root, "trades", filters], queryFn: () => api.getTrades(filters) });
export const useTrade = (id: string) => useQuery({ queryKey: [...root, "trade", id], queryFn: () => api.getTrade(id) });
export const usePositions = (closed: boolean) => useQuery({ queryKey: [...root, "positions", closed], queryFn: () => api.getPositions(closed) });
export const useStats = (filters: Filters) => useQuery({ queryKey: [...root, "stats", filters], queryFn: () => api.getStats(filters) });
export const useNotes = (filters: Filters) => useQuery({ queryKey: [...root, "notes", filters], queryFn: () => api.getNotes(filters) });
export function useJournalMutations() {
  const client = useQueryClient();
  const onSuccess = () => client.invalidateQueries({ queryKey: root });
  return {
    saveTrade: useMutation({ mutationFn: api.saveTrade, onSuccess }),
    deleteTrade: useMutation({ mutationFn: api.deleteTrade, onSuccess }),
    saveNote: useMutation({ mutationFn: api.saveNote, onSuccess }),
    deleteNote: useMutation({ mutationFn: api.deleteNote, onSuccess }),
  };
}

export const useCostSettings = () => useQuery({ queryKey: [...root, "cost-settings"], queryFn: api.getCostSettings });
export function useCostSettingsMutations() {
  const client = useQueryClient();
  const onSuccess = async () => { await client.invalidateQueries({ queryKey: root }); };
  return {
    save: useMutation({ mutationFn: api.saveCostSettings, onSuccess }),
    reset: useMutation({ mutationFn: api.resetCostSettings, onSuccess }),
  };
}
export function useCostEstimate(input: CostEstimateInput | null) {
  const key = JSON.stringify(input);
  const [debounced, setDebounced] = useState("null");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(key), 300);
    return () => clearTimeout(timer);
  }, [key]);
  const ready = key === debounced && input !== null;
  const query = useQuery({
    queryKey: [...root, "cost-estimate", debounced],
    queryFn: () => api.getCostEstimate(JSON.parse(debounced) as CostEstimateInput),
    enabled: ready,
  });
  return { ...query, data: ready ? query.data : undefined, error: ready ? query.error : null };
}

export const useConnections = () => useQuery({ queryKey: [...root, "connections"], queryFn: api.getConnections });
export const useSyncStatus = () => useQuery({ queryKey: [...root, "sync-status"], queryFn: api.getSyncStatus });
export function useSyncTrades() {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.syncTrades, onSuccess: async () => { await client.invalidateQueries({ queryKey: root }); } });
}
