import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StockKind } from "../types";
import { TONE_CLASS, changeTone, formatChange, formatChangeRate } from "../utils";

/** `kind=etf`면 "ETF" 배지를 붙인다. 주식이면 아무것도 그리지 않는다. */
export function EtfBadge({ kind, className }: { kind: StockKind; className?: string }) {
  if (kind !== "etf") return null;
  return (
    <Badge variant="secondary" className={className}>
      ETF
    </Badge>
  );
}

/** 등락(상승 빨강·하락 파랑·보합 회색). 변동 금액이 없거나 0이면 등락률만 보여 준다. */
export function ChangeText({
  rate,
  change,
  market,
  className,
}: {
  rate: number | null | undefined;
  change?: string | null;
  market?: string | null;
  className?: string;
}) {
  const tone = changeTone(rate);
  const changeText = formatChange(change, market);
  const label = tone === "up" ? "상승" : tone === "down" ? "하락" : "보합";
  return (
    <span className={cn("tabular-nums", TONE_CLASS[tone], className)} data-tone={tone}>
      <span className="sr-only">{label} </span>
      {changeText && <span className="mr-1">{changeText}</span>}
      {formatChangeRate(rate)}
    </span>
  );
}
