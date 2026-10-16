import { apiFetch } from "@/lib/api-client";
import type { ImportJob, ImportKind, ImportPreview, Mapping } from "./types";
const root = "/api/imports";
// 로컬 AI의 응답 시간을 허용한다(서버 Ollama 기본 제한 300초).
const timeoutMs = 330_000;
export const listImportKinds = () => apiFetch<{ items: ImportKind[] }>(`${root}/kinds`);
export function createImportJob(kind: string, file: File, sheetName?: string) {
  const body = new FormData();
  body.append("kind", kind); body.append("file", file);
  if (sheetName) body.append("sheetName", sheetName);
  return apiFetch<ImportJob>(`${root}/jobs`, { method: "POST", body, timeoutMs });
}
export const getImportJob = (id: string) => apiFetch<ImportJob>(`${root}/jobs/${id}`);
export const updateMapping = (id: string, mapping: Mapping) => apiFetch<ImportJob>(`${root}/jobs/${id}/mapping`, { method: "PUT", body: JSON.stringify({ mapping }) });
export const getPreview = (id: string, page = 1, pageSize = 50, onlyInvalid = false) => apiFetch<ImportPreview>(`${root}/jobs/${id}/preview?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), onlyInvalid: String(onlyInvalid) })}`);
export const commitImportJob = (id: string, skipInvalid: boolean) => apiFetch<ImportJob>(`${root}/jobs/${id}/commit`, { method: "POST", body: JSON.stringify({ skipInvalid }), timeoutMs });
export const deleteImportJob = (id: string) => apiFetch<void>(`${root}/jobs/${id}`, { method: "DELETE" });
