import { apiFetch } from "@/lib/api-client";
import type {
  AllocationReport,
  Goal,
  GoalInput,
  Holding,
  HoldingInput,
  Recommendation,
  RiskAssessment,
  RiskAssessmentCreated,
  RiskAssessmentInput,
  ScoreItem,
  Situation,
  SituationInput,
  Survey,
  TargetTable,
} from "./types";

// 자산배분 API(스펙 02 7절). 화면은 hooks.ts의 TanStack Query 훅으로 부른다.

const BASE = "/api/allocation";

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export function getSurvey(): Promise<Survey> {
  return apiFetch<Survey>(`${BASE}/survey`);
}

export function createRiskAssessment(input: RiskAssessmentInput): Promise<RiskAssessmentCreated> {
  return apiFetch<RiskAssessmentCreated>(`${BASE}/risk-assessments`, json("POST", input));
}

export async function getLatestAssessment(): Promise<RiskAssessment | null> {
  const body = await apiFetch<{ assessment: RiskAssessment | null }>(`${BASE}/risk-assessments/latest`);
  return body.assessment;
}

export function getTargetTable(): Promise<TargetTable> {
  return apiFetch<TargetTable>(`${BASE}/targets/table`);
}

export function getRecommendation(): Promise<Recommendation> {
  return apiFetch<Recommendation>(`${BASE}/recommendation`);
}

export function getReport(): Promise<AllocationReport> {
  return apiFetch<AllocationReport>(`${BASE}/report`);
}

export async function getScores(days = 180): Promise<ScoreItem[]> {
  const body = await apiFetch<{ items: ScoreItem[] }>(`${BASE}/scores?days=${days}`);
  return body.items;
}

// ── 보유 자산 ────────────────────────────────────────────────────────────

export async function listHoldings(): Promise<Holding[]> {
  const body = await apiFetch<{ items: Holding[] }>(`${BASE}/holdings`);
  return body.items;
}

export function createHolding(input: HoldingInput): Promise<Holding> {
  return apiFetch<Holding>(`${BASE}/holdings`, json("POST", input));
}

export async function bulkCreateHoldings(items: HoldingInput[]): Promise<Holding[]> {
  const body = await apiFetch<{ items: Holding[] }>(`${BASE}/holdings/bulk`, json("POST", { items }));
  return body.items;
}

export function updateHolding(id: string, input: Partial<HoldingInput>): Promise<Holding> {
  return apiFetch<Holding>(`${BASE}/holdings/${id}`, json("PATCH", input));
}

export async function deleteHolding(id: string): Promise<void> {
  await apiFetch<void>(`${BASE}/holdings/${id}`, { method: "DELETE" });
}

// ── 상황과 목표 ──────────────────────────────────────────────────────────

export async function getSituation(): Promise<Situation | null> {
  const body = await apiFetch<{ situation: Situation | null }>(`${BASE}/situation`);
  return body.situation;
}

export function putSituation(input: SituationInput): Promise<Situation> {
  return apiFetch<Situation>(`${BASE}/situation`, json("PUT", input));
}

export async function listGoals(): Promise<Goal[]> {
  const body = await apiFetch<{ items: Goal[] }>(`${BASE}/goals`);
  return body.items;
}

export function createGoal(input: GoalInput): Promise<Goal> {
  return apiFetch<Goal>(`${BASE}/goals`, json("POST", input));
}

export function updateGoal(id: string, input: Partial<GoalInput>): Promise<Goal> {
  return apiFetch<Goal>(`${BASE}/goals/${id}`, json("PATCH", input));
}

export async function deleteGoal(id: string): Promise<void> {
  await apiFetch<void>(`${BASE}/goals/${id}`, { method: "DELETE" });
}
