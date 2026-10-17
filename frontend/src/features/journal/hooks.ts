"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import type { Filters } from "./types";

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
