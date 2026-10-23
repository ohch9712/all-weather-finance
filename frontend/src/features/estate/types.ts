export type Relation = "spouse" | "child" | "grandchild" | "parent" | "other_relative";
export type DonorGroup = "parents" | "grandparents" | "spouse" | "children" | "relative" | "non_relative";
export interface Recipient {
  relation: Relation;
  birthDate: string | null;
  marriedOn: string | null;
  childBirthDates: string[];
  parentDeceased: boolean;
}
export interface Member extends Recipient {
  id: string; displayName: string; age: number | null; isMinor: boolean | null;
  createdAt: string; updatedAt: string;
}
export interface Gift {
  id: string; recipientId: string; donorGroup: DonorGroup; giftedOn: string;
  assetType: string; amount: number; appraisalFee: number; taxPaid: number;
  marriageBirthClaimed: boolean; filed: boolean; memo: string | null;
  computedDeduction: number; computedMarriageBirthDeduction: number; estimatedTax: number;
}
export interface Step { key: string; label: string; amount: number; note: string | null }
export interface TaxResult {
  steps: Step[]; payableTax: number; assumptions: string[]; notes: string[]; ruleVersion: string;
}
export interface DeductionStatus {
  asOf: string; age: number | null; isMinor: boolean | null; adultOn: string | null;
  pools: { category: string; limit: number; usedWithin10y: number; available: number; nextResetOn: string | null }[];
  marriageBirth: { limit: number; used: number; available: number; eligibleNow: boolean; windows: { kind: string; from: string; to: string }[] };
}
export interface Assets { financialAssets: number; realEstate: number; otherAssets: number }
export interface Prefill {
  assets: Assets | null; spouse: boolean;
  children: { memberId: string; displayName: string; age: number | null }[];
  grandchildren: { memberId: string; displayName: string; age: number | null }[];
  priorGiftsToHeirs10y: number; priorGiftsToNonHeirs5y: number;
  priorGiftDeductions: number; priorGiftTaxPaid: number;
}
export interface Plan {
  endDate: string;
  schedule: { giftOn: string; age: number; amount: number; deductionType: string; tax: number }[];
  totalGifted: number; totalTax: number; futureValue: number;
  lumpSum: { giftOn: string; amount: number; taxBase: number; payableTax: number };
  assumptions: string[]; ruleVersion: string;
}
export interface Scenario {
  key: string; label: string;
  gifts: { memberId: string; displayName: string; giftOn: string; amount: number; giftTax: number }[];
  totalGifted: number; giftTaxTotal: number; giftsValueAtHorizon: number; estateAtHorizon: number;
  inheritanceTax: number; totalTax: number; giftTaxAtHorizon: number; totalTaxAtHorizon: number; familyReceives: number;
  inheritance: { taxableValue: number; appliedDeduction: number; taxBase: number; payableTax: number };
}
export interface Comparison {
  baseDate: string; horizonDate: string; annualGrowthRate: string;
  scenarios: Scenario[]; recommendedKey: string; notes: string[]; assumptions: string[]; ruleVersion: string;
}
export type Payload = Record<string, unknown>;
