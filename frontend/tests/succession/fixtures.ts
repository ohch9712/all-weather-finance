import type { CaseEnvelope, Plan, PlanKey, SuccessionInput, SuccessionResult } from "@/features/succession/types";

// 스펙 22 6절 사례 A 입력과, 화면 확인에 필요한 만큼 줄인 응답.

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
  assumptions: { annualGrowthRate: "3", costInflationRate: "2", careMonthlyCost: 2_000_000, careYears: 2, officialPriceRatio: "70" },
};

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

function plan(key: PlanKey, rank: number, total: number): Plan {
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
    taxes: { giftTax: 232_800_000, acquisitionTax: 113_175_161, capitalGainsTax: 0, inheritanceTax: total - 345_975_161, total },
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
    reasons: [rank === 1 ? `입력한 조건에서 세금 총액이 가장 적어요(${total.toLocaleString("ko-KR")}원).` : "최선안보다 세금이 16,260,854원 많아요.", `${LABELS[key]} 이유`],
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
    costs: [{ year: 0, on: "2026-10-21", living: 24_000_000, care: 0, total: 24_000_000 }],
    survivorNeed: 294_166_954,
    reservePresentValue: 522_664_859,
    cashAssets: 800_000_000,
    transferableNow: 277_335_141,
    shortfall: 0,
  },
  assignments: [{ assetId: "a3", childId: "c1" }],
  plans: [
    plan("realestate_gift_cash_staged", 1, 766_564_390),
    plan("realestate_gift_now", 2, 782_825_244),
    plan("realestate_sell_cash_now", 3, 844_017_828),
    plan("inherit_only", 4, 1_033_830_010),
  ],
  excluded: [{ key: "cash_lump_now", label: LABELS.cash_lump_now, reason: "생활비·간병비를 떼어 두면 지금 넘길 현금이 없어요." }],
  notes: ["실행 전에 세무전문가에게 입력 정보와 결과를 검토받으세요."],
  assumptions: ["장례비는 최소 공제(500만 원)만 반영해요."],
  sources: [{ label: "소득세법", url: "https://www.law.go.kr/법령/소득세법" }],
};

export const SHORT_RESULT: SuccessionResult = {
  ...RESULT,
  funding: { ...RESULT.funding, transferableNow: -92_000_000, shortfall: 92_000_000 },
  plans: [plan("inherit_only", 1, 10_360_000)],
};
