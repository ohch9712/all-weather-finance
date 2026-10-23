import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column {
  label: string;
  numeric?: boolean;
}

export interface Row {
  key: string;
  cells: ReactNode[];
}

// 넓은 화면과 인쇄는 표, 좁은 화면은 행마다 "항목: 값" 카드로 보여 준다(360px 가로 스크롤 없음).
const BREAKPOINTS = {
  md: { table: "hidden md:block print:block", list: "md:hidden print:hidden" },
  xl: { table: "hidden xl:block print:block", list: "xl:hidden print:hidden" },
} as const;

export function DataTable({
  caption,
  columns,
  rows,
  breakpoint = "md",
  className,
}: {
  caption: string;
  columns: Column[];
  rows: Row[];
  breakpoint?: keyof typeof BREAKPOINTS;
  className?: string;
}) {
  const classes = BREAKPOINTS[breakpoint];
  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn(classes.table, "overflow-x-auto")}>
        <table className="w-full text-left text-sm print:text-[10px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b">
              {columns.map((column) => (
                <th key={column.label} scope="col" className={cn("p-2 align-bottom font-medium break-keep text-muted-foreground print:p-1", column.numeric && "text-right")}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b align-top break-inside-avoid">
                {row.cells.map((cell, index) => (
                  <td key={index} className={cn("p-2 print:p-1", columns[index]?.numeric && "text-right whitespace-nowrap tabular-nums")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={cn(classes.list, "space-y-2")} aria-label={caption}>
        {rows.map((row) => (
          <li key={row.key} className="rounded-lg border p-3">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              {columns.map((column, index) => (
                <Fragment key={column.label}>
                  <dt className="text-muted-foreground break-keep">{column.label}</dt>
                  <dd className={cn("min-w-0 text-right break-words", column.numeric && "tabular-nums")}>{row.cells[index]}</dd>
                </Fragment>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 2열 "항목 | 값" 표. 좁은 화면에서도 그대로 표로 둔다. */
export function KeyValueTable({ caption, rows }: { caption: string; rows: [string, ReactNode][] }) {
  return (
    <table className="w-full text-sm print:text-[10px]">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-b last:border-b-0 break-inside-avoid">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground break-keep print:py-0.5">
              {label}
            </th>
            <td className="py-1.5 text-right break-words tabular-nums print:py-0.5">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
