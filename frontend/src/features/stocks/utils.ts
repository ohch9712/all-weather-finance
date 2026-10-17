import { KST_TIME_ZONE, formatKRWCompact } from "@/lib/format";
import type { ChartPeriod } from "./types";

export const EMPTY_VALUE = "—";

export const KRX_MARKETS = new Set(["KOSPI", "KOSDAQ", "KONEX"]);

export function stockHref(code: string): string {
  return `/stocks/${encodeURIComponent(code)}`;
}

/** 내 매매 기록 탭으로 가는 주소. 기록 탭이 `symbol`을 초기 종목 필터로 읽는다(05b). */
export function journalRecordsHref(code: string): string {
  return `/journal?${new URLSearchParams({ tab: "records", symbol: code })}`;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

const fixed2 = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const grouped = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const groupedDecimal = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });

/** 가격. 국내 시장은 원 단위 정수, 그 밖은 소수까지 보여 준다. null이면 "—" */
export function formatPrice(value: string | null | undefined, market?: string | null): string {
  const number = toNumber(value);
  if (number === null) return EMPTY_VALUE;
  if (!market || KRX_MARKETS.has(market)) return `${grouped.format(Math.round(number))}원`;
  return groupedDecimal.format(number);
}

/** 가격 변동. 양수에 `+`를 붙인다. 값이 없거나 0이면 null(등락률만 보여 준다) */
export function formatChange(value: string | null | undefined, market?: string | null): string | null {
  const number = toNumber(value);
  if (number === null || number === 0) return null;
  const text = formatPrice(String(Math.abs(number)), market);
  return `${number > 0 ? "+" : "-"}${text}`;
}

/** 등락률. `-1.21` → `"-1.21%"`, `2.5` → `"+2.50%"`, null → "—" */
export function formatChangeRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  if (value === 0) return "0.00%";
  return `${value > 0 ? "+" : ""}${fixed2.format(value)}%`;
}

export type ChangeTone = "up" | "down" | "flat";

export function changeTone(rate: number | null | undefined): ChangeTone {
  if (rate === null || rate === undefined || rate === 0 || !Number.isFinite(rate)) return "flat";
  return rate > 0 ? "up" : "down";
}

/** 상승 빨강·하락 파랑·보합 회색(국내 관례) */
export const TONE_CLASS: Record<ChangeTone, string> = {
  up: "text-money-up",
  down: "text-money-down",
  flat: "text-muted-foreground",
};

/** 배수 지표(PER·PBR). `"31.86"` → `"31.86배"` */
export function formatMultiple(value: string | null | undefined): string {
  const number = toNumber(value);
  return number === null ? EMPTY_VALUE : `${fixed2.format(number)}배`;
}

/** 목록 행의 PER·PBR처럼 단위 없이 보여 줄 때 */
export function formatRatioPlain(value: string | null | undefined): string {
  const number = toNumber(value);
  return number === null ? EMPTY_VALUE : fixed2.format(number);
}

export function formatRate(value: string | null | undefined): string {
  const number = toNumber(value);
  return number === null ? EMPTY_VALUE : `${fixed2.format(number)}%`;
}

export function formatWon(value: string | null | undefined): string {
  const number = toNumber(value);
  return number === null ? EMPTY_VALUE : `${grouped.format(Math.round(number))}원`;
}

export function formatCompactWon(value: number | null | undefined): string {
  return value === null || value === undefined ? EMPTY_VALUE : formatKRWCompact(value);
}

// ── 차트 기간 ──────────────────────────────────────────────────────────

export const CHART_PERIODS: { key: ChartPeriod; label: string }[] = [
  { key: "1m", label: "1개월" },
  { key: "3m", label: "3개월" },
  { key: "6m", label: "6개월" },
  { key: "1y", label: "1년" },
];

const kstDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** KST 기준 오늘(`YYYY-MM-DD`) */
export function todayKst(now: Date = new Date()): string {
  return kstDateFormatter.format(now);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function minusMonths(year: number, month: number, day: number, months: number): Date {
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** 차트 요청 기간. `to`는 오늘(KST), `from`은 오늘 − 기간(1년은 365일 전, 08의 366일 상한 안) */
export function periodRange(period: ChartPeriod, now: Date = new Date()): { from: string; to: string } {
  const to = todayKst(now);
  const [year, month, day] = to.split("-").map(Number);
  if (period === "1y") {
    return { from: toIsoDate(new Date(Date.UTC(year, month - 1, day - 365))), to };
  }
  const months = period === "1m" ? 1 : period === "3m" ? 3 : 6;
  return { from: toIsoDate(minusMonths(year, month, day, months)), to };
}
