import type { Currency } from "./types";
export const kinds = { plan: "매매 계획", review: "복기", memo: "메모" };
export const emotions = { confident: "확신", calm: "차분", anxious: "불안", impulsive: "충동", greedy: "욕심", fearful: "두려움", regret: "후회" };
export function todayKst() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()); }
/** `"2026-10-19"`에서 `days`일 앞뒤 날짜. 날짜 문자열만 계산하므로 실행 환경의 시간대와 무관하다. */
export function shiftDate(date: string, days: number) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
export function decimalMoney(value: string, currency: Currency) {
  const [whole, fraction] = value.split(".");
  const formatted = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return currency === "USD" ? `$${formatted}.${(fraction ?? "").padEnd(2, "0")}` : `${formatted}원`;
}
// 합계 표시에도 부동소수점 오차가 들어가지 않도록 정수 스케일로 계산한다.
export function tradeAmount(quantity: string, price: string, currency: Currency) {
  function scaled(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * BigInt("1000000") + BigInt(fraction.padEnd(6, "0")); }
  const precision = currency === "USD" ? BigInt("100") : BigInt("1");
  const divisor = BigInt("1000000000000") / precision;
  const rounded = (scaled(quantity) * scaled(price) + divisor / BigInt("2")) / divisor;
  return currency === "USD" ? `${rounded / BigInt("100")}.${String(rounded % BigInt("100")).padStart(2, "0")}` : String(rounded);
}
