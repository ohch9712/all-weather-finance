// 상속·증여(과제) API 타입(스펙 22 8절, 백엔드 camelCase 그대로)

export type ParentRole = "father" | "mother";
export type Health = "good" | "normal" | "poor" | "care";
export type AssetKind = "cash" | "house" | "land";
export type DonorGroup = "parents" | "grandparents";
export type PlanKey =
  | "inherit_only"
  | "cash_staged_deduction"
  | "cash_staged_spread"
  | "cash_lump_now"
  | "realestate_gift_now"
  | "realestate_sell_cash_now"
  | "realestate_gift_cash_staged";

export interface ParentInput {
  role: ParentRole;
  alive: boolean;
  age: number | null;
  health: Health | null;
  lifeExpectancyYears: string | null;
}

export interface AssetInput {
  id: string;
  kind: AssetKind;
  label: string;
  value: number;
  officialPrice: number | null;
  region: string | null;
  regulated: boolean;
  over85: boolean;
  loan: number;
  acquiredOn: string | null;
  acquisitionCost: number | null;
  residedYears: number;
  regulatedAtAcquisition: boolean;
  parentsLiveHere: boolean;
  nonBusinessLand: boolean;
}

export interface PastGift {
  giftedOn: string;
  donorGroup: DonorGroup;
  amount: number;
  taxPaid: number;
}

export interface ChildInput {
  id: string;
  displayName: string;
  isSelf: boolean;
  age: number;
  houseCount: number;
  pastGifts: PastGift[];
}

export interface Assumptions {
  annualGrowthRate: string;
  costInflationRate: string;
  careMonthlyCost: number;
  careYears: number;
  officialPriceRatio: string;
  survivorLivingRatio: string;
  survivorIncomeRatio: string;
}

export interface SuccessionInput {
  baseDate: string | null;
  parents: ParentInput[];
  ownerRole: ParentRole;
  monthlyLivingCost: number;
  monthlyIncome: number;
  parentsHouseCount: number;
  assets: AssetInput[];
  children: ChildInput[];
  assumptions: Assumptions;
}

export interface CaseEnvelope {
  case: SuccessionInput | null;
  sensitiveConsentAt: string | null;
  updatedAt: string | null;
}

export interface LifeExpectancyInfo {
  tableLifeExpectancy: string;
  healthFactor: string;
  lifeExpectancy: string;
  yearsAssumed: number;
  source: string;
}

export interface ParentResult {
  role: ParentRole;
  age: number;
  tableLifeExpectancy: string;
  healthFactor: string;
  lifeExpectancy: string;
  yearsAssumed: number;
  expectedUntil: string;
  careFrom: string | null;
  isOwner: boolean;
}

export interface CostRow {
  year: number;
  on: string;
  living: number;
  care: number;
  income: number;
  total: number;
}

export interface Funding {
  costs: CostRow[];
  survivorNeed: number;
  reservePresentValue: number;
  cashAssets: number;
  transferableNow: number;
  shortfall: number;
  /** 두 분 중 한 분만 계시게 되는 날(21절). 없으면 null */
  singleFrom: string | null;
}

export interface Transfer {
  on: string;
  method: "gift" | "sale_gift" | "inherit";
  childId: string | null;
  assetId: string | null;
  assetLabel: string;
  assetKind: AssetKind;
  amount: number;
  giftTax: number;
  acquisitionTax: number;
  acquisitionTaxCode: "gift" | "gift_heavy" | "inherit" | "inherit_first_home" | null;
}

export interface Sale {
  assetId: string;
  label: string;
  price: number;
  acquisitionCost: number;
  holdingYears: number;
  case: "exempt" | "heavy_20" | "heavy_30" | "one_house_high" | "non_business_land" | "general";
  gain: number;
  taxableGain: number;
  longTermDeduction: number;
  taxBase: number;
  incomeTax: number;
  localIncomeTax: number;
  total: number;
  netProceeds: number;
}

export interface InheritanceSummary {
  on: string;
  financialAssets: number;
  realEstate: number;
  debts: number;
  spouseShare: number;
  priorGiftsAdded: number;
  taxableValue: number;
  appliedDeduction: number;
  taxBase: number;
  payableTax: number;
}

export interface Taxes {
  giftTax: number;
  acquisitionTax: number;
  capitalGainsTax: number;
  inheritanceTax: number;
  total: number;
  totalAtHorizon: number;
}

export interface ChildImpact {
  childId: string;
  houseCountBefore: number;
  houseCountAfter: number;
  flags: { code: string; message: string }[];
}

export interface Plan {
  key: PlanKey;
  label: string;
  rank: number;
  tier: "best" | "runner_up" | "other";
  transfers: Transfer[];
  sales: Sale[];
  inheritance: InheritanceSummary;
  taxes: Taxes;
  parentsRemainingNow: number;
  parentsReserve: number;
  childrenReceiveAtHorizon: number;
  childImpacts: ChildImpact[];
  reasons: string[];
}

export interface SuccessionResult {
  baseDate: string;
  horizonDate: string;
  spouseAliveAtHorizon: boolean;
  ruleVersion: string;
  parents: ParentResult[];
  funding: Funding;
  assignments: { assetId: string; childId: string }[];
  plans: Plan[];
  excluded: { key: PlanKey; label: string; reason: string }[];
  notes: string[];
  assumptions: string[];
  sources: { label: string; url: string }[];
}
