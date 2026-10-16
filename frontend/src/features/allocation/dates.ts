import { KST_TIME_ZONE } from "@/lib/format";

// 목표일 입력 범위(스펙 02 5.7)를 KST 날짜(`YYYY-MM-DD`)로 계산한다. 최종 판정은 서버가 한다.

const kstDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

function parseIso(value: string): [number, number, number] {
  const [year, month, day] = value.split("-").map(Number);
  return [year, month, day];
}

export function todayKst(now: Date = new Date()): string {
  return kstDateFormatter.format(now);
}

export function addDays(value: string, days: number): string {
  const [year, month, day] = parseIso(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** 같은 월·일. 없는 2월 29일은 2월 28일로 본다. */
export function addYears(value: string, years: number): string {
  const [year, month, day] = parseIso(value);
  const target = year + years;
  const lastDay = new Date(Date.UTC(target, month, 0)).getUTCDate();
  return toIso(target, month, Math.min(day, lastDay));
}

/** 목표일로 고를 수 있는 범위: 내일 ~ 오늘 + 50년 */
export function goalDateRange(now: Date = new Date()): { min: string; max: string } {
  const today = todayKst(now);
  return { min: addDays(today, 1), max: addYears(today, 50) };
}

/** `"2028-10-16"` → `"2028년 10월"` */
export function formatYearMonth(value: string): string {
  const [year, month] = parseIso(value);
  return `${year}년 ${month}월`;
}
