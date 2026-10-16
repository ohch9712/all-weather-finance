import type { AssetClass } from "@/lib/domain";
import type { GoalHorizon, GoalType, Grade } from "./types";

// 화면 상수(스펙 02 5.4·5.7·9절). 설문 문항·배분표·방향·이유 문장은 백엔드가 기준이라 여기 두지 않는다.

export const GRADE_MESSAGE: Record<Grade, string> = {
  S: "권장 배분과 거의 같아요. 지금처럼 유지하세요.",
  A: "아주 좋아요. 조금만 다듬으면 완벽해요.",
  B: "조금만 조정하면 좋아요.",
  C: "리밸런싱을 한 번 해 보면 좋겠어요.",
  D: "권장 배분과 많이 달라요. 아래 안내를 참고하세요.",
};

export const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  retirement: "노후 준비",
  home: "내 집 마련",
  education: "자녀 교육",
  marriage: "결혼 자금",
  car: "차량 구입",
  lump_sum: "목돈 마련",
  other: "기타 목표",
};

export const HORIZON_LABEL: Record<GoalHorizon, string> = {
  within_1y: "1년 안",
  within_3y: "3년 안",
  long_term: "장기",
};

export const MAX_GOALS = 10;
export const MAX_DEPENDENTS = 10;
export const MAX_MONTHLY_EXPENSE = 100_000_000;
export const MAX_AMOUNT = 1_000_000_000_000; // 보유 자산·목표 금액·고금리 대출 상한(1조 원)

export interface HoldingPreset {
  name: string;
  assetClass: AssetClass;
  includeInAllocation: boolean;
}

/** 9.3 빠른 추가 */
export const QUICK_ADD_PRESETS: readonly HoldingPreset[] = [
  { name: "예금·적금", assetClass: "cash", includeInAllocation: true },
  { name: "비상금", assetClass: "cash", includeInAllocation: true },
  { name: "국내주식", assetClass: "stock", includeInAllocation: true },
  { name: "해외주식", assetClass: "stock", includeInAllocation: true },
  { name: "채권 ETF", assetClass: "bond", includeInAllocation: true },
  { name: "금 ETF", assetClass: "gold", includeInAllocation: true },
  { name: "리츠", assetClass: "other", includeInAllocation: true },
  { name: "실거주 주택", assetClass: "other", includeInAllocation: false },
];

/** 9.3 온보딩 간단 입력 6줄. 줄 이름이 자산 이름이 된다. */
export const SIMPLE_INPUT_ROWS: readonly HoldingPreset[] = [
  { name: "예금·현금", assetClass: "cash", includeInAllocation: true },
  { name: "주식·주식형 펀드", assetClass: "stock", includeInAllocation: true },
  { name: "채권·채권형 펀드", assetClass: "bond", includeInAllocation: true },
  { name: "금", assetClass: "gold", includeInAllocation: true },
  { name: "리츠 등 기타", assetClass: "other", includeInAllocation: true },
  { name: "실거주 주택", assetClass: "other", includeInAllocation: false },
];

/** 온보딩 단계(9절). 출생연도(01b) 다음 세 단계 */
export const ONBOARDING_STEPS = ["투자성향", "목표·상황", "자산 입력"] as const;

export const ALLOCATION_PATHS = {
  report: "/allocation",
  survey: "/allocation/survey",
  situation: "/allocation/situation",
  assets: "/allocation/assets",
  recommendation: "/allocation/recommendation",
  detail: "/allocation/recommendation/detail",
} as const;

export const ONBOARDING_QUERY = "?onboarding=1";
