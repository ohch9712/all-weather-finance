"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { marketApi } from "./api";

const connectionsKey = ["market", "connections"];
export const useConnections = () => useQuery({ queryKey: connectionsKey, queryFn: marketApi.connections });
export const useSnapshotStatus = () => useQuery({ queryKey: ["market", "snapshot"], queryFn: marketApi.snapshotStatus });
export const useEgressIp = () => useQuery({ queryKey: ["market", "egress-ip"], queryFn: marketApi.egressIp, staleTime: Infinity, retry: false });
export function useConnectionActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: connectionsKey });
  return {
    create: useMutation({ mutationFn: marketApi.create, onSuccess: refresh }),
    verify: useMutation({ mutationFn: marketApi.verify, onSuccess: refresh }),
    remove: useMutation({ mutationFn: marketApi.remove, onSuccess: refresh }),
  };
}
