"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import type { GoalInput, HoldingInput } from "./types";

// 쿼리 키는 ["allocation", ...]. 상태를 바꾸면 리포트·추천·점수가 함께 달라지므로 모듈 전체를 무효화한다.

export const allocationKeys = {
  all: ["allocation"] as const,
  survey: ["allocation", "survey"] as const,
  latestAssessment: ["allocation", "risk-assessments", "latest"] as const,
  table: ["allocation", "targets", "table"] as const,
  recommendation: ["allocation", "recommendation"] as const,
  report: ["allocation", "report"] as const,
  scores: (days: number) => ["allocation", "scores", { days }] as const,
  holdings: ["allocation", "holdings"] as const,
  situation: ["allocation", "situation"] as const,
  goals: ["allocation", "goals"] as const,
  profile: ["allocation", "profile"] as const,
};

function useInvalidateAllocation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: allocationKeys.all });
}

export function useSurvey() {
  return useQuery({ queryKey: allocationKeys.survey, queryFn: api.getSurvey, staleTime: Infinity });
}

export function useLatestAssessment() {
  return useQuery({ queryKey: allocationKeys.latestAssessment, queryFn: api.getLatestAssessment });
}

export function useTargetTable(enabled = true) {
  return useQuery({ queryKey: allocationKeys.table, queryFn: api.getTargetTable, staleTime: Infinity, enabled });
}

export function useRecommendation() {
  return useQuery({ queryKey: allocationKeys.recommendation, queryFn: api.getRecommendation });
}

export function useReport() {
  return useQuery({ queryKey: allocationKeys.report, queryFn: api.getReport });
}

export function useScores(days = 180, enabled = true) {
  return useQuery({ queryKey: allocationKeys.scores(days), queryFn: () => api.getScores(days), enabled });
}

export function useHoldings() {
  return useQuery({ queryKey: allocationKeys.holdings, queryFn: api.listHoldings });
}

export function useSituation() {
  return useQuery({ queryKey: allocationKeys.situation, queryFn: api.getSituation });
}

export function useGoals() {
  return useQuery({ queryKey: allocationKeys.goals, queryFn: api.listGoals });
}

export function useProfileSummary() {
  return useQuery({ queryKey: allocationKeys.profile, queryFn: api.getProfile });
}

export function useCreateRiskAssessment() {
  const invalidate = useInvalidateAllocation();
  return useMutation({ mutationFn: api.createRiskAssessment, onSuccess: invalidate });
}

export function useCreateHolding() {
  const invalidate = useInvalidateAllocation();
  return useMutation({ mutationFn: api.createHolding, onSuccess: invalidate });
}

export function useBulkCreateHoldings() {
  const invalidate = useInvalidateAllocation();
  return useMutation({ mutationFn: api.bulkCreateHoldings, onSuccess: invalidate });
}

export function useUpdateHolding() {
  const invalidate = useInvalidateAllocation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<HoldingInput> }) => api.updateHolding(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteHolding() {
  const invalidate = useInvalidateAllocation();
  return useMutation({ mutationFn: api.deleteHolding, onSuccess: invalidate });
}

export function usePutSituation() {
  const invalidate = useInvalidateAllocation();
  return useMutation({ mutationFn: api.putSituation, onSuccess: invalidate });
}

export function useCreateGoal() {
  const invalidate = useInvalidateAllocation();
  return useMutation({ mutationFn: api.createGoal, onSuccess: invalidate });
}

export function useUpdateGoal() {
  const invalidate = useInvalidateAllocation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<GoalInput> }) => api.updateGoal(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteGoal() {
  const invalidate = useInvalidateAllocation();
  return useMutation({ mutationFn: api.deleteGoal, onSuccess: invalidate });
}


export function useBrokerConnections(enabled = true) {
  return useQuery({ queryKey: ["allocation", "broker-connections"], queryFn: api.listBrokerConnections, enabled });
}

export function useSyncHoldings() {
  const invalidate = useInvalidateAllocation();
  return useMutation({ mutationFn: api.syncHoldings, onSuccess: invalidate });
}
