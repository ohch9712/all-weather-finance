"use client";

import { Bar, BarChart as RechartsBarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import {
  ChartDataTable,
  ChartLegend,
  defaultValueFormatter,
  makeSeriesTooltip,
  type ChartSeries,
  type ValueFormatter,
} from "./ChartParts";
import { CHART_CHROME } from "./palette";

type Row = Record<string, unknown>;

interface BarChartProps<T extends Row> {
  data: T[];
  xKey: keyof T & string;
  series: ChartSeries[];
  /** Recharts와 같은 뜻이다. `horizontal`(기본)은 세로 막대, `vertical`은 가로 막대(항목 이름이 왼쪽 축) */
  layout?: "vertical" | "horizontal";
  valueFormatter?: ValueFormatter;
  ariaLabel: string;
  height?: number;
}

const TICK = { fill: CHART_CHROME.axis, fontSize: 12 };

export function BarChart<T extends Row>({
  data,
  xKey,
  series,
  layout = "horizontal",
  valueFormatter = defaultValueFormatter,
  ariaLabel,
  height = 240,
}: BarChartProps<T>) {
  const vertical = layout === "vertical";
  const categoryKey: string = xKey;
  const tickFormatter = (value: unknown) => (typeof value === "number" ? valueFormatter(value) : String(value));
  return (
    <figure className="w-full">
      <div role="img" aria-label={ariaLabel} className="w-full">
        <RechartsBarChart
          responsive
          accessibilityLayer={false}
          data={data as Row[]}
          layout={layout}
          barGap={2}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          style={{ width: "100%", height }}
        >
          <CartesianGrid stroke={CHART_CHROME.grid} vertical={vertical} horizontal={!vertical} />
          {vertical ? (
            <>
              <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} tickFormatter={tickFormatter} />
              <YAxis type="category" dataKey={categoryKey} tick={TICK} tickLine={false} axisLine={false} width="auto" />
            </>
          ) : (
            <>
              <XAxis dataKey={categoryKey} tick={TICK} tickLine={false} axisLine={{ stroke: CHART_CHROME.grid }} minTickGap={8} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={tickFormatter} width="auto" />
            </>
          )}
          <Tooltip cursor={{ fill: CHART_CHROME.cursor, opacity: 0.6 }} content={makeSeriesTooltip(series, valueFormatter)} />
          {series.map((item) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.label}
              fill={item.color}
              radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              maxBarSize={36}
              isAnimationActive={false}
            />
          ))}
        </RechartsBarChart>
      </div>
      {series.length >= 2 && <ChartLegend items={series} />}
      <ChartDataTable
        caption={ariaLabel}
        columns={["항목", ...series.map((item) => item.label)]}
        rows={data.map((row, index) => ({
          key: `${String(row[xKey])}-${index}`,
          cells: [
            String(row[xKey]),
            ...series.map((item) => (typeof row[item.key] === "number" ? valueFormatter(row[item.key] as number) : "-")),
          ],
        }))}
      />
    </figure>
  );
}
