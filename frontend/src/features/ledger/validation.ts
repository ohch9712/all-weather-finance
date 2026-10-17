import { z } from "zod";
import { ENTRY_KINDS, PAYMENT_METHODS } from "./types";
import { MAX_AMOUNT, MAX_FUTURE_DAYS, MIN_OCCURRED_ON, addDays, digitsOnly } from "./utils";

// 클라이언트 검증(스펙 03 5.2). 서버와 같은 규칙이고, 최종 판정은 서버가 한다.

export const ledgerMessages = {
  date: "날짜를 확인해 주세요.",
  amountRequired: "금액을 입력해 주세요.",
  amount: "금액은 1원부터 1조원까지 입력할 수 있어요.",
  category: "카테고리를 선택해 주세요.",
  merchant: "사용처는 100자 이내로 입력해 주세요.",
  memo: "메모는 200자 이내로 입력해 주세요.",
  categoryName: "카테고리 이름은 1~20자로 입력해 주세요.",
} as const;

// 백엔드(Python len)와 같게 문자(코드 포인트) 수로 센다.
function charLength(value: string): number {
  return Array.from(value).length;
}

function optionalText(max: number, message: string) {
  return z
    .string()
    .transform((value) => value.trim())
    .refine((value) => charLength(value) <= max, message)
    .transform((value) => (value === "" ? null : value));
}

/** 폼 값은 문자열로 받고 저장할 때 API 형식(정수 금액, null)으로 바꾼다. `today`는 KST `YYYY-MM-DD` */
export function createEntrySchema(today: string) {
  const maxDate = addDays(today, MAX_FUTURE_DAYS);
  return z.object({
    kind: z.enum(ENTRY_KINDS),
    occurredOn: z
      .string()
      .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= MIN_OCCURRED_ON && value <= maxDate, ledgerMessages.date),
    amount: z
      .string()
      .transform(digitsOnly)
      .refine((value) => value !== "", ledgerMessages.amountRequired)
      .transform(Number)
      .refine((value) => value >= 1 && value <= MAX_AMOUNT, ledgerMessages.amount),
    categoryId: z.string().min(1, ledgerMessages.category),
    merchant: optionalText(100, ledgerMessages.merchant),
    paymentMethod: z.enum(PAYMENT_METHODS),
    memo: optionalText(200, ledgerMessages.memo),
  });
}
export type EntryFormInput = z.input<ReturnType<typeof createEntrySchema>>;
export type EntryFormOutput = z.output<ReturnType<typeof createEntrySchema>>;

export const categoryNameSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => charLength(value) >= 1 && charLength(value) <= 20, ledgerMessages.categoryName);
