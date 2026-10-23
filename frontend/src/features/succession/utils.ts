import { formatKRW } from "@/lib/format";
import type { AssetKind, Health, ParentRole, Plan, PlanKey, Sale, SuccessionInput, Transfer } from "./types";

export const ROLE_LABELS: Record<ParentRole, string> = { father: "아버지", mother: "어머니" };
export const HEALTH_LABELS: Record<Health, string> = {
  good: "좋음",
  normal: "보통",
  poor: "나쁨(중증 질환)",
  care: "요양·간병 중",
};
export const KIND_LABELS: Record<AssetKind, string> = { cash: "현금·예금", house: "주택", land: "토지" };
export const METHOD_LABELS: Record<Transfer["method"], string> = {
  gift: "증여",
  sale_gift: "매각 후 현금 증여",
  inherit: "상속",
};
export const DONOR_LABELS = { parents: "부모님", grandparents: "조부모님" } as const;
export const SALE_CASE_LABELS: Record<Sale["case"], string> = {
  exempt: "1세대 1주택 비과세",
  heavy_20: "다주택 중과(+20%p)",
  heavy_30: "다주택 중과(+30%p)",
  one_house_high: "1세대 1주택(12억 원 초과분 과세)",
  non_business_land: "비사업용 토지(+10%p)",
  general: "일반 과세",
};
export const ACQUISITION_LABELS: Record<NonNullable<Transfer["acquisitionTaxCode"]>, string> = {
  gift: "취득세 일반",
  gift_heavy: "취득세 중과(12%)",
  inherit: "취득세 일반",
  inherit_first_home: "취득세 무주택 특례(0.8%)",
};
export const TIER_LABELS = ["최선안", "차선안 1", "차선안 2"] as const;
export const SHORT_PLAN_LABELS: Record<PlanKey, string> = {
  inherit_only: "모두 상속",
  cash_staged_deduction: "공제 한도 분산",
  cash_staged_spread: "현금 분산",
  cash_lump_now: "현금 일시",
  realestate_gift_now: "부동산 증여",
  realestate_sell_cash_now: "매각 후 증여",
  realestate_gift_cash_staged: "부동산+공제 분산",
};

/** 시·도 17곳(표시용). */
export const REGIONS = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"] as const;

export const REGULATED_HINT =
  "2025-10-16부터 서울 25개 구 전역과 경기 12곳(과천, 광명, 성남 분당·수정·중원, 수원 영통·장안·팔달, 안양 동안, 용인 수지, 의왕, 하남)이 조정대상지역이에요. 최신 지정은 국토교통부 공고로 확인해 주세요.";

export const REVIEW_CHECKLIST = [
  "부동산 시가(매매사례가액·감정가액)와 공시가격",
  "재산 명의와 공동명의 지분",
  "조정대상지역 지정 여부(취득 당시·증여·양도 시점)",
  "부모님 세대 주택 수, 일시적 2주택·중과 배제 특례",
  "1세대 1주택 비과세와 장기보유특별공제의 보유·거주 기간",
  "자녀 세대 주택 수, 상속주택 특례, 무주택 상속 취득세 특례",
  "과거 증여의 실제 증여자와 신고 여부",
  "배우자 실제 상속분과 2차 상속",
  "부담부증여·동거주택 상속공제·단기재상속 세액공제 적용 가능성",
  "증여받은 부동산의 이월과세(10년)",
  "기준일 이후 세법·규제지역 변경 여부",
] as const;

/** 4.4 가정값의 근거 안내 */
export const ASSUMPTION_HINTS = {
  annualGrowthRate: "앱 가정값(06 방향 비교와 같음)",
  costInflationRate: "앱 가정값(한국은행 물가안정목표 2%)",
  careMonthlyCost: "요양병원 간병비 월평균 200만~267만 원 수준이라는 보도를 참고한 앱 가정값",
  careYears: "앱 가정값",
  officialPriceRatio: "앱 가정값(공동주택 공시가격 현실화율 약 69%)",
  survivorLivingRatio: "앱 가정값(2026년 기준 중위소득 1인 가구 2,564,238원 ÷ 2인 가구 4,199,292원 ≈ 61%)",
  survivorIncomeRatio:
    "앱 가정값(국민연금 유족연금은 가입기간에 따라 기본연금액의 40~60%, 본인 연금과 겹치면 본인 연금 + 유족연금 30%)",
} as const;

export function childNames(input: SuccessionInput | null): Record<string, string> {
  return Object.fromEntries((input?.children ?? []).map((child) => [child.id, child.displayName]));
}

export function recipientName(names: Record<string, string>, childId: string | null): string {
  return childId ? (names[childId] ?? "자녀") : "자녀 공동";
}

/** 비교표 "이전 대상과 자산 종류": 받는 사람마다 자산 종류와 방법을 묶는다. */
export function summarizeRecipients(plan: Plan, names: Record<string, string>): string[] {
  const groups = new Map<string, Set<string>>();
  for (const transfer of plan.transfers) {
    if (transfer.amount <= 0) continue;
    const who = recipientName(names, transfer.childId);
    const what =
      transfer.childId === null
        ? "금융재산"
        : transfer.method === "sale_gift"
          ? "부동산 판 돈"
          : KIND_LABELS[transfer.assetKind];
    const label = `${what}(${transfer.method === "inherit" ? "상속" : "증여"})`;
    groups.set(who, (groups.get(who) ?? new Set()).add(label));
  }
  return [...groups].map(([who, labels]) => `${who}: ${[...labels].join(", ")}`);
}

/** 비교표 "이전 금액과 시기": 날짜별 합계. */
export function summarizeSchedule(plan: Plan): { on: string; method: "gift" | "inherit"; amount: number }[] {
  const totals = new Map<string, { on: string; method: "gift" | "inherit"; amount: number }>();
  for (const transfer of plan.transfers) {
    const method = transfer.method === "inherit" ? "inherit" : "gift";
    const key = `${transfer.on}-${method}`;
    const row = totals.get(key) ?? { on: transfer.on, method, amount: 0 };
    row.amount += transfer.amount;
    totals.set(key, row);
  }
  return [...totals.values()].sort((a, b) => a.on.localeCompare(b.on));
}

export function scheduleText(row: { on: string; method: "gift" | "inherit"; amount: number }): string {
  return `${row.on} ${row.method === "inherit" ? "상속" : "증여"} ${formatKRW(row.amount)}`;
}

export function todayKst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}
