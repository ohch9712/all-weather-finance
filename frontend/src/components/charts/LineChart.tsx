"use client";

import { CartesianGrid, Line, LineChart as RechartsLineChart, Tooltip, XAxis, YAxis } from "recharts";
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

interface LineChartProps<T extends Row> {
  data: T[];
  xKey: keyof T & string;
  series: ChartSeries[];
  valueFormatter?: ValueFormatter;
  ariaLabel: string;
  height?: number;
}

const TICK = { fill: CHART_CHROME.axis, fontSize: 12 };

export function LineChart<T extends Row>({
  data,
  xKey,
  series,
  valueFormatter = defaultValueFormatter,
  ariaLabel,
  height = 240,
}: LineChartProps<T>) {
  const categoryKey: string = xKey;
  const tickFormatter = (value: unknown) => (typeof value === "number" ? valueFormatter(value) : String(value));
  return (
    <figure className="w-full">
      <div role="img" aria-label={ariaLabel} className="w-full">
        <RechartsLineChart
          responsive
          accessibilityLayer={false}
          data={data as Row[]}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          style={{ width: "100%", height }}
        >
          <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
          <XAxis dataKey={categoryKey} tick={TICK} tickLine={false} axisLine={{ stroke: CHART_CHROME.grid }} minTickGap={12} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={tickFormatter} width="auto" />
          <Tooltip cursor={{ stroke: CHART_CHROME.axis, strokeDasharray: "3 3" }} content={makeSeriesTooltip(series, valueFormatter)} />
          {series.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: CHART_CHROME.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </RechartsLineChart>
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
