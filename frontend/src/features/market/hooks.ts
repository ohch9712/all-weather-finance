"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { marketApi } from "./api";

const connectionsKey = ["market", "connections"];
export const useConnections = () => useQuery({ queryKey: connectionsKey, queryFn: marketApi.connections });
export const useSnapshotStatus = () => useQuery({ queryKey: ["market", "snapshot"], queryFn: marketApi.snapshotStatus });
// 외부 IP 조회 서비스를 부르므로 화면 진입 시 자동 조회하지 않고 버튼을 누를 때만 부른다(스펙 08 9절).
// 상태는 컴포넌트에 머물러 화면을 떠나면 사라진다.
export const useEgressIp = () => useMutation({ mutationFn: marketApi.egressIp });
// 키는 저장하지 않고 계좌 목록만 받아 폼 안에서 고르게 한다(스펙 08 9절).
export const useTossAccounts = () => useMutation({ mutationFn: marketApi.tossAccounts });
export function useConnectionActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: connectionsKey });
  return {
    create: useMutation({ mutationFn: marketApi.create, onSuccess: refresh }),
    verify: useMutation({ mutationFn: marketApi.verify, onSuccess: refresh }),
    update: useMutation({ mutationFn: marketApi.update, onSuccess: refresh }),
    remove: useMutation({ mutationFn: marketApi.remove, onSuccess: refresh }),
  };
}
