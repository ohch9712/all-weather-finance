import { apiFetch } from "@/lib/api-client";
import type { Page } from "@/types/api";
import type {
  Category,
  CategoryCreateInput,
  CategoryList,
  Entry,
  EntryInput,
  EntryListParams,
  MonthlySummary,
  Trend,
} from "./types";

export function getCategories(): Promise<CategoryList> {
  return apiFetch<CategoryList>("/api/ledger/categories");
}

export function createCategory(input: CategoryCreateInput): Promise<Category> {
  return apiFetch<Category>("/api/ledger/categories", { method: "POST", body: JSON.stringify(input) });
}

export function renameCategory(id: string, name: string): Promise<Category> {
  return apiFetch<Category>(`/api/ledger/categories/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export async function deleteCategory(id: string): Promise<void> {
  await apiFetch<void>(`/api/ledger/categories/${id}`, { method: "DELETE" });
}

/** 빈 필터는 보내지 않는다. */
export function getEntries(params: EntryListParams): Promise<Page<Entry>> {
  const search = new URLSearchParams({ month: params.month });
  if (params.kind) search.set("kind", params.kind);
  if (params.categoryId) search.set("categoryId", params.categoryId);
  if (params.q) search.set("q", params.q);
  search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize));
  return apiFetch<Page<Entry>>(`/api/ledger/entries?${search}`);
}

export function createEntry(input: EntryInput): Promise<Entry> {
  return apiFetch<Entry>("/api/ledger/entries", { method: "POST", body: JSON.stringify(input) });
}

export function updateEntry(id: string, input: Partial<EntryInput>): Promise<Entry> {
  return apiFetch<Entry>(`/api/ledger/entries/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deleteEntry(id: string): Promise<void> {
  await apiFetch<void>(`/api/ledger/entries/${id}`, { method: "DELETE" });
}

export function getSummary(month: string): Promise<MonthlySummary> {
  return apiFetch<MonthlySummary>(`/api/ledger/summary?month=${month}`);
}

export function getTrend(months: number): Promise<Trend> {
  return apiFetch<Trend>(`/api/ledger/trend?months=${months}`);
}
