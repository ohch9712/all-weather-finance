import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { estateApi } from "./api";
import type { Payload } from "./types";

export function useMembers() { return useQuery({ queryKey: ["estate", "members"], queryFn: estateApi.members }); }
export function useGifts(id: string) { return useQuery({ queryKey: ["estate", "gifts", id], queryFn: () => estateApi.gifts(id), enabled: Boolean(id) }); }
export function useDeductions(id: string) { return useQuery({ queryKey: ["estate", "deductions", id], queryFn: () => estateApi.deductions(id), enabled: Boolean(id) }); }
export function usePrefill() { return useQuery({ queryKey: ["estate", "prefill"], queryFn: estateApi.prefill }); }
export function useEstateWrite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, data = {}, id }: { kind: "member" | "gift" | "deleteMember" | "deleteGift"; data?: Payload; id?: string }) => {
      if (kind === "member") return estateApi.saveMember(data, id);
      if (kind === "gift") return estateApi.saveGift(data, id);
      if (kind === "deleteMember") return estateApi.deleteMember(id!);
      return estateApi.deleteGift(id!);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["estate"] }),
  });
}
export function useGiftTax() { return useMutation({ mutationFn: estateApi.giftTax }); }
export function useInheritanceTax() { return useMutation({ mutationFn: estateApi.inheritanceTax }); }
export function useGiftPlan() { return useMutation({ mutationFn: estateApi.giftPlan }); }
export function useCompare() { return useMutation({ mutationFn: estateApi.compare }); }
