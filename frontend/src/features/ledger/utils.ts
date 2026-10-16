import { KST_TIME_ZONE } from "@/lib/format";
import type { CategoryAmount, Entry, EntryFilters, EntryKind, PaymentMethod } from "./types";

export const KIND_LABEL: Record<EntryKind, string> = { expense: "지출", income: "수입" };

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "카드",
  cash: "현금",
  transfer: "계좌이체",
  other: "기타",
};

export const SOURCE_LABEL = { import: "명세서", codef: "자동 수집" } as const;

export const PAGE_SIZE = 20;
export const TREND_MONTHS = 6;
/** 도넛에 따로 보여 줄 지출 카테고리 수. 나머지는 "그 외"로 묶는다. */
export const DONUT_TOP = 6;
export const MAX_AMOUNT = 1_000_000_000_000;
export const MIN_OCCURRED_ON = "2000-01-01";
export const MAX_FUTURE_DAYS = 366;

// ── 날짜·달 ─────────────────────────────────────────────────────────

const kstDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** KST 오늘 `YYYY-MM-DD` */
export function todayKst(now: Date = new Date()): string {
  return kstDateFormatter.format(now);
}

/** `YYYY-MM-DD`에 일수를 더한다. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const MONTH_PATTERN = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;

export function isValidMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

/** KST 이번 달 `YYYY-MM` */
export function currentMonth(now: Date = new Date()): string {
  return todayKst(now).slice(0, 7);
}

/** `YYYY-MM`에 달 수를 더한다. */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** `"2026-10"` → `"2026년 10월"` */
export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${year}년 ${monthNumber}월`;
}

/** `"2026-10"` → `"10월"` */
export function formatShortMonth(month: string): string {
  return `${Number(month.slice(5, 7))}월`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** `"2026-10-15"` → `"10월 15일 (목)"` */
export function formatDayHeader(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}월 ${day}일 (${weekday})`;
}

// ── 필터 ↔ URL ──────────────────────────────────────────────────────

/** URL 쿼리에서 필터를 읽는다. 잘못된 값은 기본값(이번 달, 전체)으로 본다. */
export function parseFilters(params: Pick<URLSearchParams, "get">, now: Date = new Date()): EntryFilters {
  const month = params.get("month");
  const kind = params.get("kind");
  return {
    month: isValidMonth(month) ? month : currentMonth(now),
    kind: kind === "income" || kind === "expense" ? kind : null,
    categoryId: params.get("categoryId") || null,
    q: params.get("q")?.trim() ?? "",
  };
}

/** 필터를 URL 쿼리로 바꾼다. 빈 값은 넣지 않는다. */
export function buildFilterQuery(filters: EntryFilters): string {
  const params = new URLSearchParams();
  params.set("month", filters.month);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.q) params.set("q", filters.q);
  return params.toString();
}

// ── 금액 입력 ───────────────────────────────────────────────────────

/** 금액 입력값에서 숫자만 남긴다. 앞의 0은 지운다. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/** `"1234567"` → `"1,234,567"`. 빈 문자열은 그대로 */
export function groupAmountInput(value: string): string {
  const digits = digitsOnly(value);
  return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "";
}

// ── 목록·차트 데이터 ─────────────────────────────────────────────────

export interface DayGroup {
  date: string;
  income: number;
  expense: number;
  entries: Entry[];
}

/** 날짜순(이미 정렬된 목록)으로 묶고 그날 수입·지출 합계를 낸다. */
export function groupByDate(entries: Entry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    let group = groups.at(-1);
    if (!group || group.date !== entry.occurredOn) {
      group = { date: entry.occurredOn, income: 0, expense: 0, entries: [] };
      groups.push(group);
    }
    group[entry.kind] += entry.amount;
    group.entries.push(entry);
  }
  return groups;
}

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
}

/** 지출 카테고리를 금액 순 상위 `top`개와 "그 외"로 나눈다. */
export function toExpenseSlices(byCategory: CategoryAmount[], top = DONUT_TOP): DonutSlice[] {
  const expenses = byCategory.filter((item) => item.kind === "expense").sort((a, b) => b.amount - a.amount);
  const slices = expenses.slice(0, top).map((item) => ({ key: item.categoryId, label: item.name, value: item.amount }));
  const rest = expenses.slice(top).reduce((sum, item) => sum + item.amount, 0);
  if (rest > 0) slices.push({ key: "rest", label: "그 외", value: rest });
  return slices;
}
