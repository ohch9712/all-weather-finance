"use client";

import { useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { seriesColor } from "@/components/charts/palette";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { useCandles } from "../hooks";
import type { ChartPeriod } from "../types";
import { CHART_PERIODS, KRX_MARKETS } from "../utils";

const priceAxis = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

/** 기간별 종가 선 그래프. 요청은 `candles?from=<오늘(KST) − 기간>&to=<오늘>` */
export function StockChart({ code, name, market }: { code: string; name: string; market: string }) {
  const [period, setPeriod] = useState<ChartPeriod>("3m");
  const candles = useCandles(code, period);
  const periodLabel = CHART_PERIODS.find((item) => item.key === period)?.label ?? "";
  const rows = (candles.data?.items ?? []).map((candle) => ({
    date: period === "1y" ? formatDate(candle.date).slice(2) : formatDate(candle.date).slice(5),
    close: Number(candle.close),
  }));
  const unit = KRX_MARKETS.has(market) ? "원" : "";

  return (
    <section aria-labelledby="chart-heading" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="chart-heading" className="font-semibold">
          종가 추이
        </h2>
        <div role="group" aria-label="차트 기간" className="flex gap-1">
          {CHART_PERIODS.map((item) => (
            <Button
              key={item.key}
              type="button"
              size="sm"
              variant={item.key === period ? "default" : "outline"}
              aria-pressed={item.key === period}
              onClick={() => setPeriod(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      {candles.isPending ? (
        <Skeleton className="h-60 w-full" />
      ) : candles.isError ? (
        <p role="alert" className="py-16 text-center text-sm text-muted-foreground break-keep">
          차트를 불러오지 못했어요. {getErrorMessage(candles.error)}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">이 기간의 차트 데이터가 없어요.</p>
      ) : (
        <LineChart
          data={rows}
          xKey="date"
          series={[{ key: "close", label: "종가", color: seriesColor(0) }]}
          valueFormatter={(value) => `${priceAxis.format(value)}${unit}`}
          ariaLabel={`${name} 종가 추이(${periodLabel})`}
        />
      )}
    </section>
  );
}
