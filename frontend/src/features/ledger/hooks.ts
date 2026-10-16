"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createCategory,
  createEntry,
  deleteCategory,
  deleteEntry,
  getCategories,
  getEntries,
  getSummary,
  getTrend,
  renameCategory,
  updateEntry,
} from "./api";
import type { EntryInput, EntryListParams } from "./types";

export const ledgerKeys = {
  all: ["ledger"] as const,
  categories: () => ["ledger", "categories"] as const,
  entries: () => ["ledger", "entries"] as const,
  entryList: (params: EntryListParams) => ["ledger", "entries", params] as const,
  summaries: () => ["ledger", "summary"] as const,
  summary: (month: string) => ["ledger", "summary", month] as const,
  trends: () => ["ledger", "trend"] as const,
  trend: (months: number) => ["ledger", "trend", months] as const,
};

/** 내역이 바뀌면 목록·요약·추이를 다시 불러온다. */
function invalidateEntryData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ledgerKeys.entries() }),
    queryClient.invalidateQueries({ queryKey: ledgerKeys.summaries() }),
    queryClient.invalidateQueries({ queryKey: ledgerKeys.trends() }),
  ]);
}

export function useCategories() {
  return useQuery({ queryKey: ledgerKeys.categories(), queryFn: getCategories, select: (data) => data.items });
}

export function useEntries(params: EntryListParams) {
  return useQuery({
    queryKey: ledgerKeys.entryList(params),
    queryFn: () => getEntries(params),
    placeholderData: keepPreviousData,
  });
}

export function useSummary(month: string) {
  return useQuery({ queryKey: ledgerKeys.summary(month), queryFn: () => getSummary(month) });
}

export function useTrend(months: number) {
  return useQuery({ queryKey: ledgerKeys.trend(months), queryFn: () => getTrend(months) });
}

export function useSaveEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: EntryInput }) =>
      id ? updateEntry(id, input) : createEntry(input),
    onSuccess: () => invalidateEntryData(queryClient),
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteEntry,
    onSuccess: () => invalidateEntryData(queryClient),
  });
}

/** 카테고리 이름·삭제는 내역의 카테고리 이름과 요약에도 반영되므로 가계부 쿼리를 모두 다시 불러온다. */
function useCategoryMutation<Variables, Result>(mutationFn: (variables: Variables) => Promise<Result>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ledgerKeys.all }),
  });
}

export function useCreateCategory() {
  return useCategoryMutation(createCategory);
}

export function useRenameCategory() {
  return useCategoryMutation(({ id, name }: { id: string; name: string }) => renameCategory(id, name));
}

export function useDeleteCategory() {
  return useCategoryMutation(deleteCategory);
}
