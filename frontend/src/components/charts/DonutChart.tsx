"use client";

import type { ReactNode } from "react";
import { Pie, PieChart, Tooltip, type TooltipContentProps } from "recharts";
import { formatPercent } from "@/lib/format";
import { ChartDataTable, ChartLegend, TooltipBox, defaultValueFormatter, type ValueFormatter } from "./ChartParts";
import { CHART_CHROME, cssVar } from "./palette";

export interface DonutDatum {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutDatum[];
  centerLabel?: ReactNode;
  ariaLabel: string;
  /** 툴팁·숨김 표의 값 표시. 기본은 천 단위 쉼표 */
  valueFormatter?: ValueFormatter;
}

function share(value: number, total: number): string {
  return formatPercent(total > 0 ? (value / total) * 100 : 0, 1);
}

/** 비중 도넛. 범례(비중 포함)와 같은 데이터의 숨김 표를 함께 그린다. */
export function DonutChart({ data, centerLabel, ariaLabel, valueFormatter = defaultValueFormatter }: DonutChartProps) {
  const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const slices =
    total > 0
      ? data.filter((item) => item.value > 0).map((item) => ({ ...item, fill: item.color }))
      : [{ key: "empty", label: "", value: 1, color: cssVar("--muted"), fill: cssVar("--muted") }];

  function DonutTooltip({ active, payload }: TooltipContentProps) {
    const item = payload?.[0]?.payload as DonutDatum | undefined;
    if (!active || !item || total === 0) return null;
    return (
      <TooltipBox
        rows={[
          {
            key: item.key,
            label: item.label,
            color: item.color,
            value: `${valueFormatter(item.value)} (${share(item.value, total)})`,
          },
        ]}
      />
    );
  }

  return (
    <figure className="w-full">
      <div className="relative mx-auto aspect-square w-full max-w-60" role="img" aria-label={ariaLabel}>
        <PieChart responsive accessibilityLayer={false} style={{ width: "100%", height: "100%" }}>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            innerRadius="64%"
            outerRadius="100%"
            stroke={CHART_CHROME.surface}
            strokeWidth={2}
            isAnimationActive={false}
          />
          {total > 0 && <Tooltip content={DonutTooltip} />}
        </PieChart>
        {centerLabel !== undefined && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-[22%] text-center text-sm">
            {centerLabel}
          </div>
        )}
      </div>
      <ChartLegend
        items={data.map((item) => ({ key: item.key, label: item.label, color: item.color, value: share(item.value, total) }))}
      />
      <ChartDataTable
        caption={ariaLabel}
        columns={["항목", "값", "비중"]}
        rows={data.map((item) => ({
          key: item.key,
          cells: [item.label, valueFormatter(item.value), share(item.value, total)],
        }))}
      />
    </figure>
  );
}
