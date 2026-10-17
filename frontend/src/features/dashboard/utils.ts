import { KST_TIME_ZONE, formatKRW } from "@/lib/format";
import type { AllocationStatus, ChecklistItem, TradeCurrency } from "./types";

export const EMPTY_VALUE = "—";

const longDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

/** 오늘(KST). 예: "2026년 10월 17일 토요일" */
export function formatTodayKst(now: Date = new Date()): string {
  return longDateFormatter.format(now);
}

/** `"2026-10"` → `"10월"` */
export function formatMonthLabel(month: string): string {
  const value = Number(month.split("-")[1]);
  return Number.isFinite(value) && value > 0 ? `${value}월` : month;
}

export function checklistProgress(items: ChecklistItem[]) {
  const done = items.filter((item) => item.done).length;
  const total = items.length;
  return { done, total, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/** 체크리스트를 모두 끝냈으면 카드를 숨긴다. 항목이 없으면 보일 것이 없다. */
export function isChecklistComplete(items: ChecklistItem[]): boolean {
  return items.every((item) => item.done);
}

/** 배분 리포트가 `ready`가 아닐 때 다음 단계 */
export const ALLOCATION_NEXT_STEP: Record<Exclude<AllocationStatus, "ready">, { label: string; href: string; hint: string }> = {
  needs_profile: {
    label: "출생연도 입력하기",
    href: "/settings/profile",
    hint: "나이대를 알아야 권장 배분을 계산할 수 있어요.",
  },
  needs_assessment: {
    label: "투자성향 진단하기",
    href: "/allocation/survey",
    hint: "투자성향을 진단하면 권장 배분과 먼저 할 일을 알려 드려요.",
  },
  needs_holdings: {
    label: "보유 자산 입력하기",
    href: "/allocation/assets",
    hint: "보유 자산을 입력하면 배분 점수를 계산해요.",
  },
};

export type Tone = "up" | "down" | "flat";

export function toneOf(value: number | null | undefined): Tone {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

/** 국내 관례: 상승·이익은 빨강, 하락·손실은 파랑 */
export const TONE_CLASS: Record<Tone, string> = {
  up: "text-money-up",
  down: "text-money-down",
  flat: "text-muted-foreground",
};

const fixed2 = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** 등락률. `-1.21` → `"-1.21%"`, `2.5` → `"+2.50%"`, null → `"—"` */
export function formatChangeRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  if (value === 0) return "0.00%";
  return `${value > 0 ? "+" : ""}${fixed2.format(value)}%`;
}

const priceFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

/** 문자열 decimal 시세를 천 단위 쉼표로. 응답에 시장 정보가 없어 단위는 붙이지 않는다. */
export function formatPrice(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return EMPTY_VALUE;
  const number = Number(value);
  return Number.isFinite(number) ? priceFormatter.format(number) : EMPTY_VALUE;
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 통화별 실현손익(문자열 decimal). 양수에 `+`를 붙인다. KRW `"74040"` → `"+74,040원"` */
export function formatRealizedPnl(currency: TradeCurrency, value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return EMPTY_VALUE;
  const sign = number > 0 ? "+" : number < 0 ? "-" : "";
  const absolute = Math.abs(number);
  const text = currency === "KRW" ? formatKRW(absolute) : usdFormatter.format(absolute);
  return `${sign}${text}`;
}

/** 배분 점수 변화. `3` → `"+3점"`, `-2` → `"-2점"`, `0` → `"변화 없음"` */
export function formatScoreDelta(delta: number): string {
  if (delta === 0) return "변화 없음";
  return `${delta > 0 ? "+" : ""}${delta}점`;
}

/** 전월 대비 지출 변화 문장. 지출이 늘면 `up` */
export function describeExpenseChange(rate: number | null): string {
  if (rate === null) return "지난달 지출 기록이 없어요";
  if (rate === 0) return "지난달과 지출이 같아요";
  return `지난달보다 ${fixed2.format(Math.abs(rate))}% ${rate > 0 ? "늘었어요" : "줄었어요"}`;
}

export function stockHref(code: string): string {
  return `/stocks/${encodeURIComponent(code)}`;
}

export function learnPostHref(slug: string): string {
  return `/learn/${encodeURIComponent(slug)}`;
}

/** AI 상담 예시 질문(스펙 16 4절). 누르면 위젯 입력창에 채운다. */
export const CHAT_EXAMPLE_QUESTIONS = [
  "왜 이렇게 배분하라고 추천했어?",
  "이번 달 지출에서 줄일 만한 곳이 있을까?",
  "아이에게 증여할 때 공제가 얼마나 남았어?",
] as const;
