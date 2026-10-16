import { cn } from "@/lib/utils";
import type { Currency } from "../types";
import { decimalMoney } from "../utils";
export function JournalMoney({ value, currency, signed = false }: { value: string | null; currency: Currency; signed?: boolean }) {
  if (value === null) return <span>—</span>;
  const sign = Number(value);
  return <span className={cn("tabular-nums break-all", signed && sign > 0 && "text-money-up", signed && sign < 0 && "text-money-down")}>{signed && sign > 0 ? "+" : ""}{decimalMoney(value, currency)}</span>;
}
