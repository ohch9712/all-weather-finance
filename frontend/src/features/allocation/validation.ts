import { z } from "zod";
import { ASSET_CLASSES } from "@/lib/domain";
import { MAX_AMOUNT, MAX_DEPENDENTS, MAX_MONTHLY_EXPENSE } from "./constants";
import { goalDateRange } from "./dates";
import { GOAL_TYPES } from "./types";

// 클라이언트 검증(스펙 02 5.7·7.6). 서버와 같은 범위이고 최종 판정은 서버가 한다.
// 금액 입력은 숫자만 남긴 문자열로 받는다(AmountInput).

export const allocationMessages = {
  holdingName: "이름은 1~50자로 입력해 주세요.",
  assetClass: "자산군을 골라 주세요.",
  amountRequired: "금액을 입력해 주세요.",
  amountMax: "1조 원 이하로 입력해 주세요.",
  memo: "메모는 200자 이내로 입력해 주세요.",
  monthlyExpenseRequired: "월 생활비를 입력해 주세요.",
  monthlyExpenseMax: "1억 원 이하로 입력해 주세요.",
  dependents: "부양가족 수를 골라 주세요.",
  goalType: "목표 종류를 골라 주세요.",
  goalTitle: "이름은 30자 이내로 입력해 주세요.",
  goalAmount: "1원 이상 1조 원 이하로 입력해 주세요.",
  goalDate: "목표일은 내일부터 50년 안으로 골라 주세요.",
} as const;

// 백엔드(Python len)와 같게 UTF-16 코드 유닛이 아니라 문자(코드 포인트) 수로 센다.
function charLength(value: string): number {
  return Array.from(value).length;
}

/** `"20,000,000"` → `20000000`. 비었으면 null */
export function parseAmount(value: string): number | null {
  const digits = value.replace(/[^\d]/g, "");
  return digits === "" ? null : Number(digits);
}

function amountField(options: { required: string; max: number; maxMessage: string; min?: number; minMessage?: string }) {
  return z
    .string()
    .transform((value) => parseAmount(value))
    .refine((value) => value !== null, options.required)
    .transform((value) => value as number)
    .refine((value) => value <= options.max, options.maxMessage)
    .refine((value) => value >= (options.min ?? 0), options.minMessage ?? options.maxMessage);
}

function optionalAmountField(max: number, maxMessage: string) {
  return z
    .string()
    .transform((value) => parseAmount(value) ?? 0)
    .refine((value) => value <= max, maxMessage);
}

export const holdingSchema = z.object({
  name: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => charLength(value) >= 1 && charLength(value) <= 50, allocationMessages.holdingName),
  assetClass: z.enum(ASSET_CLASSES, allocationMessages.assetClass),
  amount: amountField({
    required: allocationMessages.amountRequired,
    max: MAX_AMOUNT,
    maxMessage: allocationMessages.amountMax,
  }),
  includeInAllocation: z.boolean(),
  memo: z
    .string()
    .refine((value) => charLength(value) <= 200, allocationMessages.memo)
    .transform((value) => (value.trim() === "" ? null : value)),
});
export type HoldingFormInput = z.input<typeof holdingSchema>;
export type HoldingFormOutput = z.output<typeof holdingSchema>;

export const situationSchema = z.object({
  monthlyExpense: amountField({
    required: allocationMessages.monthlyExpenseRequired,
    max: MAX_MONTHLY_EXPENSE,
    maxMessage: allocationMessages.monthlyExpenseMax,
  }),
  dependents: z
    .string()
    .refine((value) => /^\d+$/.test(value) && Number(value) <= MAX_DEPENDENTS, allocationMessages.dependents)
    .transform(Number),
  consumerDebt: optionalAmountField(MAX_AMOUNT, allocationMessages.amountMax),
});
export type SituationFormInput = z.input<typeof situationSchema>;
export type SituationFormOutput = z.output<typeof situationSchema>;

export function createGoalSchema(now: Date = new Date()) {
  const { min, max } = goalDateRange(now);
  return z.object({
    goalType: z.enum(GOAL_TYPES, allocationMessages.goalType),
    title: z
      .string()
      .transform((value) => value.trim())
      .refine((value) => charLength(value) <= 30, allocationMessages.goalTitle),
    targetAmount: amountField({
      required: allocationMessages.goalAmount,
      max: MAX_AMOUNT,
      maxMessage: allocationMessages.goalAmount,
      min: 1,
    }),
    // `YYYY-MM-DD`는 글자 순서가 날짜 순서와 같다.
    targetDate: z
      .string()
      .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= min && value <= max, allocationMessages.goalDate),
  });
}
export type GoalFormInput = z.input<ReturnType<typeof createGoalSchema>>;
export type GoalFormOutput = z.output<ReturnType<typeof createGoalSchema>>;
