import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { successionApi } from "./api";
import type { CaseEnvelope, Health, ParentRole, SuccessionInput } from "./types";

const caseKey = ["succession", "case"] as const;

export function useSuccessionCase() {
  return useQuery({ queryKey: caseKey, queryFn: successionApi.getCase });
}

export function useLifeExpectancy(role: ParentRole, age: number | null, health: Health | null) {
  const valid = age !== null && Number.isInteger(age) && age >= 40 && age <= 110;
  return useQuery({
    queryKey: ["succession", "life-expectancy", role, age, health],
    queryFn: () => successionApi.lifeExpectancy(role, age!, health),
    enabled: valid,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

function useCaseMutation<TArgs>(mutationFn: (args: TArgs) => Promise<CaseEnvelope | void>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      client.setQueryData<CaseEnvelope>(caseKey, data ?? { case: null, sensitiveConsentAt: null, updatedAt: null });
    },
  });
}

export function useSaveCase() {
  return useCaseMutation(({ input, consent }: { input: SuccessionInput; consent: boolean }) =>
    successionApi.saveCase(input, consent),
  );
}

export function useDeleteCase() {
  return useCaseMutation(() => successionApi.deleteCase());
}

export function useWithdrawConsent() {
  return useCaseMutation(() => successionApi.withdrawConsent());
}

export function useComparePlans() {
  return useMutation({ mutationFn: successionApi.plans });
}
