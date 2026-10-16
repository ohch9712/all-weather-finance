import type { ReactNode } from "react";
import type { TooltipContentProps } from "recharts";

// 차트 래퍼가 함께 쓰는 범례·툴팁·숨김 표. 값과 라벨은 텍스트 색 토큰을 쓰고, 색 견본만 계열 색을 쓴다.

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export type ValueFormatter = (value: number) => string;

export const defaultValueFormatter: ValueFormatter = (value) => value.toLocaleString("ko-KR");

export function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
}

export function ChartLegend({ items }: { items: { key: string; label: string; color: string; value?: ReactNode }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-hidden="true">
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-center gap-1.5">
          <Swatch color={item.color} />
          <span className="text-foreground">{item.label}</span>
          {item.value !== undefined && <span className="tabular-nums">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

interface TooltipRow {
  key: string;
  label: string;
  color: string;
  value: string;
}

export function TooltipBox({ title, rows }: { title?: ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="min-w-32 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {title !== undefined && title !== "" && <p className="mb-1 font-medium">{title}</p>}
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Swatch color={row.color} />
              {row.label}
            </span>
            <span className="font-medium tabular-nums">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 가로·세로 축 차트(Bar·Line)의 툴팁. 계열 순서대로 값을 보여 준다. */
export function makeSeriesTooltip(series: ChartSeries[], formatValue: ValueFormatter) {
  return function SeriesTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const rows = series.flatMap((item) => {
      const entry = payload.find((candidate) => candidate.dataKey === item.key);
      if (!entry || typeof entry.value !== "number") return [];
      return [{ key: item.key, label: item.label, color: item.color, value: formatValue(entry.value) }];
    });
    return <TooltipBox title={label} rows={rows} />;
  };
}

/** 차트와 같은 데이터의 표. 화면에는 보이지 않고 스크린리더가 읽는다. */
export function ChartDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: { key: string; cells: string[] }[];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {row.cells.map((cell, index) =>
              index === 0 ? (
                <th key={index} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={index}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
