// 가계부 API 타입(스펙 03 5절). 필드 이름은 백엔드 camelCase 그대로다.

export const ENTRY_KINDS = ["expense", "income"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const PAYMENT_METHODS = ["card", "cash", "transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type EntrySource = "manual" | "import" | "codef";

export interface Category {
  id: string;
  kind: EntryKind;
  name: string;
  isDefault: boolean;
  sortOrder: number;
}

export interface CategoryList {
  items: Category[];
}

export interface CategoryCreateInput {
  kind: EntryKind;
  name: string;
}

export interface EntryInput {
  kind: EntryKind;
  /** `YYYY-MM-DD` */
  occurredOn: string;
  /** 원(정수) */
  amount: number;
  categoryId: string;
  merchant: string | null;
  paymentMethod: PaymentMethod;
  memo: string | null;
}

export interface Entry extends EntryInput {
  id: string;
  categoryName: string;
  source: EntrySource;
  createdAt: string;
  updatedAt: string;
}

/** 목록 필터. URL 쿼리 `?month=&kind=&categoryId=&q=`와 같다. */
export interface EntryFilters {
  /** `YYYY-MM` */
  month: string;
  kind: EntryKind | null;
  categoryId: string | null;
  q: string;
}

export interface EntryListParams extends EntryFilters {
  page: number;
  pageSize: number;
}

export interface MonthTotals {
  month: string;
  incomeTotal: number;
  expenseTotal: number;
}

export interface CategoryAmount {
  categoryId: string;
  name: string;
  kind: EntryKind;
  amount: number;
  /** 같은 종류 합계 대비 비율(%) */
  ratio: number;
}

export interface DailyAmount {
  date: string;
  income: number;
  expense: number;
}

export interface MerchantAmount {
  merchant: string;
  amount: number;
  count: number;
}

export interface MonthlySummary {
  month: string;
  incomeTotal: number;
  expenseTotal: number;
  net: number;
  previous: MonthTotals;
  /** 전월 지출이 0이면 null */
  expenseChangeRate: number | null;
  byCategory: CategoryAmount[];
  daily: DailyAmount[];
  topMerchants: MerchantAmount[];
}

export interface Trend {
  items: MonthTotals[];
}
