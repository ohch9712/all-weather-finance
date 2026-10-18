"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { connectorsApi } from "./api";
import type { AccountKind, ConnectorAccount } from "./types";

const key = ["connectors"];
const accountsKey = [...key, "accounts"];
const syncsKey = (id: string) => [...key, "syncs", id];
export const useConnectorProviders = () => useQuery({ queryKey: [...key, "providers"], queryFn: connectorsApi.providers });
export const useConnectorOrganizations = (kind: AccountKind) => useQuery({ queryKey: [...key, "organizations", kind], queryFn: () => connectorsApi.organizations(kind) });
export const useConnectorAccounts = () => useQuery({ queryKey: accountsKey, queryFn: connectorsApi.accounts });
export function useConnectorSyncs(id: string) {
  const client = useQueryClient();
  // 계정 목록 캐시에서 빠진(삭제한) 계정은 카드가 사라지기 전에 다시 렌더링되더라도 이력을 부르지 않고,
  // 그 렌더링이 다시 만든 빈 캐시 항목도 카드가 사라지면 바로 지운다.
  const listed = () => client.getQueryData<{ items: ConnectorAccount[] }>(accountsKey)?.items.some((item) => item.id === id) ?? true;
  return useQuery({
    queryKey: syncsKey(id),
    queryFn: () => connectorsApi.syncs(id),
    enabled: listed,
    ...(listed() ? {} : { gcTime: 0 }),
    refetchInterval: (query) => query.state.data?.items[0]?.status === "running" ? 3000 : false,
  });
}
export function useConnectorActions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: key });
  // removedId가 있으면 삭제한 계정의 이력 쿼리는 무효화 대상에서 뺀다.
  const refreshData = async (removedId?: string) => {
    const connectors = removedId ? client.invalidateQueries({ queryKey: key, predicate: (query) => !(query.queryKey[1] === "syncs" && query.queryKey[2] === removedId) }) : refresh();
    await Promise.all([connectors, client.invalidateQueries({ queryKey: ["ledger"] }), client.invalidateQueries({ queryKey: ["allocation"] }), client.invalidateQueries({ queryKey: ["dashboard"] })]);
  };
  // 삭제한 계정의 카드가 아직 떠 있을 때 이력을 다시 부르면 404가 나므로(웨이브 4 통합 검증 F1),
  // 계정 목록에서 먼저 빼고 그 계정의 이력 캐시를 지운 뒤 나머지만 갱신한다.
  const afterRemove = async (_: void, { id }: { id: string; localOnly?: boolean }) => {
    // 진행 중인 목록 요청이 삭제 전 목록으로 캐시를 덮어쓰지 않게 먼저 취소한다.
    await client.cancelQueries({ queryKey: accountsKey });
    client.setQueryData<{ items: ConnectorAccount[] }>(accountsKey, (data) => data && { ...data, items: data.items.filter((item) => item.id !== id) });
    await client.cancelQueries({ queryKey: syncsKey(id) });
    client.removeQueries({ queryKey: syncsKey(id) });
    await refreshData(id);
  };
  return {
    create: useMutation({ mutationFn: connectorsApi.create, onSuccess: refresh, gcTime: 0 }),
    remove: useMutation({ mutationFn: connectorsApi.remove, onSuccess: afterRemove }),
    sync: useMutation({ mutationFn: connectorsApi.sync, onSettled: () => refreshData() }),
  };
}
