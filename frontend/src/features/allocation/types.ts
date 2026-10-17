import type { AgeBand, AssetClass, RiskProfile } from "@/lib/domain";

// 자산배분 API 타입(스펙 02 7절). 필드 이름은 백엔드 camelCase 그대로다.

export type ByAssetClass<T> = Record<AssetClass, T>;

/** 01 `GET /api/profile` 응답 중 이 모듈이 쓰는 필드 */
export interface ProfileSummary {
  birthYear: number | null;
  age: number | null;
  ageBand: AgeBand | null;
}

// ── 설문·진단 ────────────────────────────────────────────────────────────

export interface SurveyOption {
  value: number;
  label: string;
}

export interface SurveyQuestion {
  id: string;
  text: string;
  options: SurveyOption[];
}

export interface Survey {
  version: number;
  questions: SurveyQuestion[];
}

export type SurveyAnswers = Record<string, number>;

export interface RiskAssessmentInput {
  surveyVersion: number;
  answers: SurveyAnswers;
}

export interface RiskAssessmentCreated {
  id: string;
  score: number;
  riskProfile: RiskProfile;
  createdAt: string;
}

export interface RiskAssessment extends RiskAssessmentCreated {
  answers: SurveyAnswers;
}

// ── 권장 배분표 ──────────────────────────────────────────────────────────

export interface TargetTableCell {
  riskProfile: RiskProfile;
  weights: ByAssetClass<number>;
}

export interface TargetTableRow {
  ageBand: AgeBand;
  cells: TargetTableCell[];
}

export interface TargetTable {
  rows: TargetTableRow[];
}

// ── 보유 자산 ────────────────────────────────────────────────────────────

export type HoldingSource = "manual" | "kiwoom" | "toss" | "codef" | "mock";

export interface Holding {
  id: string;
  name: string;
  assetClass: AssetClass;
  amount: number;
  includeInAllocation: boolean;
  source: HoldingSource;
  connectionId: string | null;
  syncedAt: string | null;
  classOverride: boolean;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HoldingInput {
  name: string;
  assetClass: AssetClass;
  amount: number;
  includeInAllocation: boolean;
  memo: string | null;
}

// ── 상황과 목표 ──────────────────────────────────────────────────────────

export interface SituationInput {
  monthlyExpense: number;
  dependents: number;
  consumerDebt: number;
}

export interface Situation extends SituationInput {
  emergencyMonths: number;
  emergencyTarget: number;
  updatedAt: string;
}

export const GOAL_TYPES = ["retirement", "home", "education", "marriage", "car", "lump_sum", "other"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];
export type GoalHorizon = "within_1y" | "within_3y" | "long_term";

export interface GoalInput {
  goalType: GoalType;
  title: string;
  targetAmount: number;
  targetDate: string;
}

export interface Goal extends GoalInput {
  id: string;
  horizon: GoalHorizon;
  createdAt: string;
  updatedAt: string;
}

// ── 리포트·점수 ──────────────────────────────────────────────────────────

export type Grade = "S" | "A" | "B" | "C" | "D";
export type ReportStatus = "needs_profile" | "needs_assessment" | "needs_holdings" | "ready";

export interface ReportClass {
  assetClass: AssetClass;
  actualAmount: number;
  actualWeight: number;
  targetWeight: number;
  targetAmount: number;
  diffAmount: number;
}

export interface AllocationReport {
  status: ReportStatus;
  ageBand: AgeBand | null;
  riskProfile: RiskProfile | null;
  totalAmount: number;
  excludedAmount: number;
  score: number | null;
  grade: Grade | null;
  scoreDelta: number | null;
  scoredOn: string | null;
  classes: ReportClass[] | null;
}

export interface ScoreItem {
  scoredOn: string;
  score: number;
  grade: Grade;
}

// ── 추천 ─────────────────────────────────────────────────────────────────

export type RecommendationStatus = "needs_profile" | "needs_assessment" | "ready";

export interface EmergencyLayer {
  monthlyExpense: number;
  months: number;
  targetAmount: number;
  allocatedAmount: number | null;
}

export interface ShortTermGoalLayer {
  goalId: string;
  title: string;
  targetDate: string;
  horizon: GoalHorizon;
  targetAmount: number;
  allocatedAmount: number | null;
  assetClass: AssetClass;
}

export type DirectionKind =
  | "pay_consumer_debt"
  | "build_emergency_fund"
  | "reserve_short_term_goal"
  | "rebalance"
  | "keep_allocation"
  | "long_term_goal"
  | "input_situation"
  | "input_holdings";

export interface Direction {
  kind: DirectionKind;
  priority: number;
  title: string;
  body: string;
  amount: number | null;
  assetClass: AssetClass | null;
  href: string;
}

export interface Reason {
  code: "age_band" | "risk_profile" | "emergency_fund" | "short_term_goals" | "long_term_mix";
  title: string;
  body: string;
}

export interface AssetClassNote {
  assetClass: AssetClass;
  weight: number;
  note: string;
}

export interface AnswerContribution {
  questionId: string;
  question: string;
  answerLabel: string;
  points: number;
  maxPoints: number;
}

export interface Recommendation {
  status: RecommendationStatus;
  layering: "applied" | "needs_holdings" | null;
  ageBand: AgeBand | null;
  riskProfile: RiskProfile | null;
  riskScore: number | null;
  riskProfileSummary: string | null;
  risky: { start: number; adjustment: number; final: number; clamped: boolean } | null;
  baseWeights: ByAssetClass<number> | null;
  totalAmount: number | null;
  layers: {
    emergency: EmergencyLayer | null;
    shortTermGoals: ShortTermGoalLayer[];
    longTermAmount: number | null;
  } | null;
  targetAmounts: ByAssetClass<number> | null;
  targetWeights: ByAssetClass<number> | null;
  directions: Direction[];
  reasons: Reason[];
  assetClassNotes: AssetClassNote[];
  answerContributions: AnswerContribution[];
}


export interface BrokerConnection {
  id: string;
  provider: "mock" | "kiwoom" | "toss";
  label: string;
  status: "unverified" | "active" | "error";
}

export interface HoldingSyncResult {
  created: number;
  updated: number;
  removed: number;
  skipped: { name: string; reason: string }[];
  syncedAt: string;
}
