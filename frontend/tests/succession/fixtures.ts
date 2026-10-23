import type { CaseEnvelope, Plan, PlanKey, SuccessionInput, SuccessionResult, Taxes } from "@/features/succession/types";

// 스펙 22 6절 사례 A·21절 사례 D 입력과, 화면 확인에 필요한 만큼 줄인 응답.

export const CASE_A: SuccessionInput = {
  baseDate: "2026-10-21",
  parents: [
    { role: "father", alive: true, age: 75, health: "normal", lifeExpectancyYears: null },
    { role: "mother", alive: true, age: 72, health: "good", lifeExpectancyYears: null },
  ],
  ownerRole: "father",
  monthlyLivingCost: 3_000_000,
  monthlyIncome: 1_000_000,
  parentsHouseCount: 2,
  assets: [
    { id: "a1", kind: "cash", label: "현금 예금", value: 800_000_000, officialPrice: null, region: null, regulated: false, over85: false, loan: 0, acquiredOn: null, acquisitionCost: null, residedYears: 0, regulatedAtAcquisition: false, parentsLiveHere: false, nonBusinessLand: false },
    { id: "a3", kind: "house", label: "임대 아파트", value: 700_000_000, officialPrice: 480_000_000, region: "경기", regulated: true, over85: false, loan: 200_000_000, acquiredOn: "2015-03-01", acquisitionCost: 400_000_000, residedYears: 0, regulatedAtAcquisition: false, parentsLiveHere: false, nonBusinessLand: false },
  ],
  children: [
    { id: "c1", displayName: "나", isSelf: true, age: 45, houseCount: 1, pastGifts: [{ giftedOn: "2019-05-01", donorGroup: "parents", amount: 50_000_000, taxPaid: 0 }] },
    { id: "c2", displayName: "동생", isSelf: false, age: 42, houseCount: 0, pastGifts: [] },
  ],
  // 21절: 사례 A는 두 비율을 100으로 둔다.
  assumptions: { annualGrowthRate: "3", costInflationRate: "2", careMonthlyCost: 2_000_000, careYears: 2, officialPriceRatio: "70", survivorLivingRatio: "100", survivorIncomeRatio: "100" },
};

// 21절 사례 D: 사례 A에서 두 비율만 기본값(61·60).
export const CASE_D: SuccessionInput = {
  ...CASE_A,
  assumptions: { ...CASE_A.assumptions, survivorLivingRatio: "61", survivorIncomeRatio: "60" },
};

const CARE_LINE = "간병비는 부모님마다 예상 시점 전 마지막 2년에 들어간다고 봐요. 건강 상태가 '요양·간병 중'인 분은 지금부터 예상 시점까지 들어가요.";

export function envelope(input: SuccessionInput | null, consentAt: string | null = null): CaseEnvelope {
  return { case: input, sensitiveConsentAt: consentAt, updatedAt: input ? "2026-10-21T03:00:00Z" : null };
}

const LABELS: Record<PlanKey, string> = {
  inherit_only: "증여 없이 모두 상속",
  cash_staged_deduction: "현금을 10년마다 공제 한도만큼 증여",
  cash_staged_spread: "현금을 10년마다 나눠 증여(이전 가능액 전부)",
  cash_lump_now: "이전 가능액을 지금 현금으로 증여",
  realestate_gift_now: "부동산을 지금 그대로 증여",
  realestate_sell_cash_now: "부동산을 팔아 현금으로 지금 증여",
  realestate_gift_cash_staged: "부동산 증여 + 현금 10년 공제 한도 증여",
};

// 6절 사례 A 표의 세금(증여세, 취득세, 양도세, 상속세, 낸 금액 합계, 상속 시점 기준 합계).
const TAXES: Partial<Record<PlanKey, Taxes>> = {
  realestate_gift_cash_staged: { giftTax: 232_800_000, acquisitionTax: 113_175_161, capitalGainsTax: 0, inheritanceTax: 420_589_229, total: 766_564_390, totalAtHorizon: 907_861_575 },
  realestate_gift_now: { giftTax: 232_800_000, acquisitionTax: 113_175_161, capitalGainsTax: 0, inheritanceTax: 436_850_083, total: 782_825_244, totalAtHorizon: 924_122_429 },
  cash_lump_now: { giftTax: 25_802_264, acquisitionTax: 43_650_289, capitalGainsTax: 0, inheritanceTax: 866_960_875, total: 936_413_428, totalAtHorizon: 947_407_960 },
  realestate_sell_cash_now: { giftTax: 110_525_583, acquisitionTax: 14_375_161, capitalGainsTax: 220_187_000, inheritanceTax: 498_930_084, total: 844_017_828, totalAtHorizon: 984_936_877 },
};

const BEST_AT_HORIZON = 907_861_575;

function plan(key: PlanKey, rank: number, taxes: Taxes = TAXES[key]!): Plan {
  return {
    key,
    label: LABELS[key],
    rank,
    tier: rank === 1 ? "best" : rank <= 3 ? "runner_up" : "other",
    transfers: [
      { on: "2026-10-21", method: "gift", childId: "c1", assetId: "a3", assetLabel: "임대 아파트", assetKind: "house", amount: 700_000_000, giftTax: 162_960_000, acquisitionTax: 86_800_000, acquisitionTaxCode: "gift_heavy" },
      { on: "2038-10-21", method: "inherit", childId: null, assetId: null, assetLabel: "금융재산(자녀 공동)", assetKind: "cash", amount: 395_509_673, giftTax: 0, acquisitionTax: 0, acquisitionTaxCode: null },
    ],
    sales:
      key === "realestate_sell_cash_now"
        ? [{ assetId: "a3", label: "임대 아파트", price: 700_000_000, acquisitionCost: 400_000_000, holdingYears: 11, case: "heavy_20", gain: 300_000_000, taxableGain: 300_000_000, longTermDeduction: 0, taxBase: 297_500_000, incomeTax: 152_610_000, localIncomeTax: 15_261_000, total: 167_871_000, netProceeds: 332_129_000 }]
        : [],
    inheritance: { on: "2038-10-21", financialAssets: 689_676_627, realEstate: 2_139_160_974, debts: 200_000_000, spouseShare: 294_166_954, priorGiftsAdded: 0, taxableValue: 2_623_837_601, appliedDeduction: 1_097_935_325, taxBase: 1_525_902_276, payableTax: 436_850_083 },
    taxes,
    parentsRemainingNow: 2_100_000_000,
    parentsReserve: 522_664_859,
    childrenReceiveAtHorizon: 2_836_655_533,
    childImpacts: [
      {
        childId: "c1",
        houseCountBefore: 1,
        houseCountAfter: 2,
        flags: [{ code: "carryover_basis", message: "증여받은 부동산을 10년 안에 팔면 부모님이 산 값으로 양도세를 계산해요(이월과세)." }],
      },
    ],
    reasons: [
      rank === 1
        ? `상속 시점(2038-10-21) 기준으로 맞춘 세금 합계가 가장 적어요(${taxes.totalAtHorizon.toLocaleString("ko-KR")}원).`
        : `상속 시점 기준 세금 합계가 최선안보다 ${(taxes.totalAtHorizon - BEST_AT_HORIZON).toLocaleString("ko-KR")}원 많아요.`,
      `${LABELS[key]} 이유`,
    ],
  };
}

export const RESULT: SuccessionResult = {
  baseDate: "2026-10-21",
  horizonDate: "2038-10-21",
  spouseAliveAtHorizon: true,
  ruleVersion: "KR-2026.05.10",
  parents: [
    { role: "father", age: 75, tableLifeExpectancy: "12.0", healthFactor: "1.0", lifeExpectancy: "12.0", yearsAssumed: 12, expectedUntil: "2038-10-21", careFrom: "2036-10-21", isOwner: true },
    { role: "mother", age: 72, tableLifeExpectancy: "17.5", healthFactor: "1.1", lifeExpectancy: "19.3", yearsAssumed: 19, expectedUntil: "2045-10-21", careFrom: "2043-10-21", isOwner: false },
  ],
  funding: {
    // 사례 A 0·10년차(20절): 필요 금액 = 생활비 + 간병비 − 수입.
    costs: [
      { year: 0, on: "2026-10-21", living: 36_000_000, care: 0, income: 12_000_000, total: 24_000_000 },
      { year: 10, on: "2036-10-21", living: 43_883_799, care: 29_255_866, income: 14_627_933, total: 58_511_732 },
    ],
    survivorNeed: 294_166_954,
    reservePresentValue: 522_664_859,
    cashAssets: 800_000_000,
    transferableNow: 277_335_141,
    shortfall: 0,
    singleFrom: "2038-10-21",
  },
  assignments: [{ assetId: "a3", childId: "c1" }],
  // 19절 순위(상속 시점 기준 세금 순)의 1~4위.
  plans: [
    plan("realestate_gift_cash_staged", 1),
    plan("realestate_gift_now", 2),
    plan("cash_lump_now", 3),
    plan("realestate_sell_cash_now", 4),
  ],
  excluded: [{ key: "cash_staged_spread", label: LABELS.cash_staged_spread, reason: "생활비·간병비를 떼어 두면 지금 넘길 현금이 없어요." }],
  notes: ["실행 전에 세무전문가에게 입력 정보와 결과를 검토받으세요."],
  assumptions: [
    "생활·간병비는 부모님 현금에서 쓰고, 모자라도 부동산을 팔지 않는다고 봐요.",
    "월 생활비·월 수입은 두 분 합계로 보고, 한 분만 계시게 되는 2038-10-21부터는 월 생활비를 100%, 월 수입을 100%로 계산해요.",
    CARE_LINE,
    "장례비는 최소 공제(500만 원)만 반영해요.",
  ],
  sources: [{ label: "소득세법", url: "https://www.law.go.kr/법령/소득세법" }],
};

// 21절 사례 D 응답: 0·12년차 비용과 S·R·A, 가구·간병 줄. 방안은 화면 확인용으로 사례 A 것을 쓴다.
export const RESULT_D: SuccessionResult = {
  ...RESULT,
  funding: {
    costs: [
      { year: 0, on: "2026-10-21", living: 36_000_000, care: 0, income: 12_000_000, total: 24_000_000 },
      { year: 12, on: "2038-10-21", living: 27_850_588, care: 0, income: 9_131_340, total: 18_719_248 },
    ],
    survivorNeed: 207_047_900,
    reservePresentValue: 461_576_150,
    cashAssets: 800_000_000,
    transferableNow: 338_423_850,
    shortfall: 0,
    singleFrom: "2038-10-21",
  },
  assumptions: [
    "생활·간병비는 부모님 현금에서 쓰고, 모자라도 부동산을 팔지 않는다고 봐요.",
    "월 생활비·월 수입은 두 분 합계로 보고, 한 분만 계시게 되는 2038-10-21부터는 월 생활비를 61%, 월 수입을 60%로 계산해요.",
    CARE_LINE,
    "장례비는 최소 공제(500만 원)만 반영해요.",
  ],
};

export const SHORT_RESULT: SuccessionResult = {
  ...RESULT,
  // 사례 B처럼 한 분만 계셔서 singleFrom이 없다.
  funding: { ...RESULT.funding, transferableNow: -92_000_000, shortfall: 92_000_000, singleFrom: null },
  plans: [plan("inherit_only", 1, { giftTax: 0, acquisitionTax: 10_360_000, capitalGainsTax: 0, inheritanceTax: 0, total: 10_360_000, totalAtHorizon: 10_360_000 })],
};

// 월 수입이 생활비와 간병비보다 많아 모든 해의 필요 금액이 0인 결과(20절).
export const COVERED_RESULT: SuccessionResult = {
  ...RESULT,
  funding: {
    ...RESULT.funding,
    costs: [
      { year: 0, on: "2026-10-21", living: 36_000_000, care: 0, income: 1_200_000_000, total: 0 },
      { year: 10, on: "2036-10-21", living: 43_883_799, care: 29_255_866, income: 1_462_793_315, total: 0 },
    ],
    survivorNeed: 0,
    reservePresentValue: 0,
    transferableNow: 800_000_000,
  },
};
