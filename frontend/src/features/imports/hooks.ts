"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import type { ImportJob, Mapping } from "./types";
export const useImportKinds = () => useQuery({ queryKey: ["imports", "kinds"], queryFn: api.listImportKinds });
export const useImportJob = (id?: string) => useQuery({ queryKey: ["imports", "job", id], queryFn: () => api.getImportJob(id!), enabled: !!id });
export const useImportPreview = (id: string | undefined, page = 1, onlyInvalid = false) => useQuery({ queryKey: ["imports", "preview", id, page, onlyInvalid], queryFn: () => api.getPreview(id!, page, 50, onlyInvalid), enabled: !!id, retry: false });
function useSaveJob() {
  const client = useQueryClient();
  return (job: ImportJob) => {
    client.setQueryData(["imports", "job", job.id], job);
    void client.invalidateQueries({ queryKey: ["imports", "preview", job.id] });
  };
}
export function useCreateImportJob() { return useMutation({ mutationFn: ({ kind, file, sheetName }: { kind: string; file: File; sheetName?: string }) => api.createImportJob(kind, file, sheetName), onSuccess: useSaveJob() }); }
export function useUpdateMapping() { return useMutation({ mutationFn: ({ id, mapping }: { id: string; mapping: Mapping }) => api.updateMapping(id, mapping), onSuccess: useSaveJob() }); }
export function useCommitImportJob() { return useMutation({ mutationFn: ({ id, skipInvalid }: { id: string; skipInvalid: boolean }) => api.commitImportJob(id, skipInvalid), onSuccess: useSaveJob() }); }
export function useDeleteImportJob() {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.deleteImportJob, onSuccess: (_, id) => client.removeQueries({ queryKey: ["imports", "job", id] }) });
}
