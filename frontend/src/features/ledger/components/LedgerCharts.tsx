"use client";

import type { ReactNode } from "react";
import { BarChart } from "@/components/charts/BarChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { cssVar, seriesColor } from "@/components/charts/palette";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKRW, formatKRWCompact } from "@/lib/format";
import { useTrend } from "../hooks";
import type { MonthlySummary } from "../types";
import { TREND_MONTHS, formatMonthLabel, formatShortMonth, toExpenseSlices } from "../utils";

// 수입은 파랑(목록의 수입 색과 같은 계열), 지출은 주황
const INCOME_COLOR = cssVar("--chart-1");
const EXPENSE_COLOR = cssVar("--chart-2");

export function ChartCard({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h3>{title}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

function NoData({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground break-keep">{children}</p>;
}

/** 지출 카테고리 도넛: 상위 6개 + "그 외" */
export function ExpenseDonut({ summary }: { summary: MonthlySummary }) {
  const slices = toExpenseSlices(summary.byCategory);
  if (slices.length === 0) return <NoData>이 달에는 지출이 없어요.</NoData>;
  return (
    <DonutChart
      ariaLabel={`${formatMonthLabel(summary.month)} 지출 카테고리 비중`}
      data={slices.map((slice, index) => ({ ...slice, color: seriesColor(index) }))}
      valueFormatter={formatKRW}
      centerLabel={
        <span className="flex flex-col">
          <span className="text-xs text-muted-foreground">지출</span>
          <span className="font-semibold tabular-nums">{formatKRWCompact(summary.expenseTotal)}</span>
        </span>
      }
    />
  );
}

/** 그 달의 일별 지출 막대 */
export function DailyExpenseChart({ summary }: { summary: MonthlySummary }) {
  if (summary.expenseTotal === 0) return <NoData>이 달에는 지출이 없어요.</NoData>;
  const data = summary.daily.map((day) => ({ day: `${Number(day.date.slice(8))}일`, expense: day.expense }));
  return (
    <BarChart
      ariaLabel={`${formatMonthLabel(summary.month)} 일별 지출`}
      data={data}
      xKey="day"
      series={[{ key: "expense", label: "지출", color: EXPENSE_COLOR }]}
      valueFormatter={formatKRWCompact}
      height={200}
    />
  );
}

/** 이번 달을 포함한 최근 6개월 수입·지출 막대 */
export function TrendChart() {
  const { data, error, isPending, refetch } = useTrend(TREND_MONTHS);
  if (isPending) return <LoadingState rows={2} />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const rows = data.items.map((item) => ({
    month: formatShortMonth(item.month),
    income: item.incomeTotal,
    expense: item.expenseTotal,
  }));
  const first = data.items[0]?.month;
  const last = data.items.at(-1)?.month;
  return (
    <BarChart
      ariaLabel={first && last ? `${formatMonthLabel(first)}부터 ${formatMonthLabel(last)}까지 수입·지출` : "최근 수입·지출"}
      data={rows}
      xKey="month"
      series={[
        { key: "income", label: "수입", color: INCOME_COLOR },
        { key: "expense", label: "지출", color: EXPENSE_COLOR },
      ]}
      valueFormatter={formatKRWCompact}
      height={220}
    />
  );
}

/** 자주 쓴 곳 상위 5개(지출, 금액 순) */
export function TopMerchants({ summary }: { summary: MonthlySummary }) {
  if (summary.topMerchants.length === 0) return <NoData>사용처를 적은 지출이 없어요.</NoData>;
  return (
    <ol aria-label="자주 쓴 곳" className="divide-y">
      {summary.topMerchants.map((item, index) => (
        <li key={item.merchant} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
          <span className="w-4 shrink-0 text-center text-sm font-semibold text-muted-foreground tabular-nums">{index + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{item.merchant}</span>
            <span className="text-xs text-muted-foreground">{item.count}건</span>
          </span>
          <span className="shrink-0 text-sm font-medium tabular-nums">{formatKRW(item.amount)}</span>
        </li>
      ))}
    </ol>
  );
}
