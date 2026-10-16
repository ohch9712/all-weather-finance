import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKRW, formatPercent, formatSignedKRW } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MonthlySummary } from "../types";

function SummaryCard({ title, value, note, valueClassName }: { title: string; value: string; note?: ReactNode; valueClassName?: string }) {
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className={cn("text-base font-semibold break-all tabular-nums sm:text-xl", valueClassName)}>{value}</p>
        {note && <p className="text-xs text-muted-foreground break-keep">{note}</p>}
      </CardContent>
    </Card>
  );
}

/** 지난달보다 지출이 줄면 "아꼈어요", 늘면 "더 썼어요" */
function changeNote(summary: MonthlySummary): string {
  const rate = summary.expenseChangeRate;
  if (rate === null) return "지난달 지출 기록이 없어요";
  const diff = summary.expenseTotal - summary.previous.expenseTotal;
  if (diff < 0) return `지난달보다 ${formatKRW(-diff)} 아꼈어요`;
  if (diff > 0) return `지난달보다 ${formatKRW(diff)} 더 썼어요`;
  return "지난달과 같아요";
}

function formatRate(rate: number | null): string {
  if (rate === null) return "-";
  return `${rate > 0 ? "+" : ""}${formatPercent(rate, 2)}`;
}

/** 수입, 지출, 순수입, 전월 대비 지출 */
export function SummaryCards({ summary }: { summary: MonthlySummary }) {
  const rate = summary.expenseChangeRate;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <SummaryCard title="수입" value={formatKRW(summary.incomeTotal)} valueClassName="text-money-down" />
      <SummaryCard title="지출" value={formatKRW(summary.expenseTotal)} />
      <SummaryCard title="순수입" value={formatSignedKRW(summary.net)} note="수입 − 지출" />
      <SummaryCard
        title="전월 대비 지출"
        value={formatRate(rate)}
        valueClassName={cn(rate !== null && rate < 0 && "text-money-down")}
        note={changeNote(summary)}
      />
    </div>
  );
}
