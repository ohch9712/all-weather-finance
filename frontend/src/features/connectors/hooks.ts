"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { connectorsApi } from "./api";
import type { AccountKind } from "./types";

const key = ["connectors"];
export const useConnectorProviders = () => useQuery({ queryKey: [...key, "providers"], queryFn: connectorsApi.providers });
export const useConnectorOrganizations = (kind: AccountKind) => useQuery({ queryKey: [...key, "organizations", kind], queryFn: () => connectorsApi.organizations(kind) });
export const useConnectorAccounts = () => useQuery({ queryKey: [...key, "accounts"], queryFn: connectorsApi.accounts });
export const useConnectorSyncs = (id: string) => useQuery({ queryKey: [...key, "syncs", id], queryFn: () => connectorsApi.syncs(id), refetchInterval: (query) => query.state.data?.items[0]?.status === "running" ? 3000 : false });
export function useConnectorActions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const refreshData = async () => {
    await Promise.all([refresh(), client.invalidateQueries({ queryKey: ["ledger"] }), client.invalidateQueries({ queryKey: ["allocation"] }), client.invalidateQueries({ queryKey: ["dashboard"] })]);
  };
  return {
    create: useMutation({ mutationFn: connectorsApi.create, onSuccess: refresh, gcTime: 0 }),
    remove: useMutation({ mutationFn: connectorsApi.remove, onSuccess: refreshData }),
    sync: useMutation({ mutationFn: connectorsApi.sync, onSettled: refreshData }),
  };
}
