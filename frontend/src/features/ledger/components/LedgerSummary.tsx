"use client";

import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { useSummary } from "../hooks";
import { ChartCard, DailyExpenseChart, ExpenseDonut, TopMerchants, TrendChart } from "./LedgerCharts";
import { SummaryCards } from "./SummaryCards";

/** 선택한 달의 요약 카드·차트·자주 쓴 곳과 최근 6개월 추이 */
export function LedgerSummary({ month }: { month: string }) {
  const { data: summary, error, isPending, refetch } = useSummary(month);

  return (
    <section aria-label="월간 요약" className="space-y-4">
      {isPending ? (
        <LoadingState rows={2} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <SummaryCards summary={summary} />
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="지출 카테고리">
              <ExpenseDonut summary={summary} />
            </ChartCard>
            <ChartCard title="일별 지출" className="lg:col-span-2">
              <DailyExpenseChart summary={summary} />
            </ChartCard>
          </div>
        </>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="최근 6개월 수입·지출" className="lg:col-span-2">
          <TrendChart />
        </ChartCard>
        {summary && (
          <ChartCard title="자주 쓴 곳">
            <TopMerchants summary={summary} />
          </ChartCard>
        )}
      </div>
    </section>
  );
}
