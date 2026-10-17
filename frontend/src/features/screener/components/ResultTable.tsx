"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/common/EmptyState";
import { SampleDataBadge } from "@/components/common/SampleDataBadge";
import { Disclaimer } from "@/components/common/Disclaimer";
import { formatKRW, formatKRWCompact, formatPercent } from "@/lib/format";
import { getErrorMessage, isApiError } from "@/lib/api-client";
import { useAddWatchlist } from "../hooks";
import type {
  FilterField,
  ScreenFilter,
  ScreenItem,
  ScreenResult,
} from "../types";

const columns = [
  ["name", "종목명"],
  ["market", "시장"],
  ["price", "현재가"],
  ["changeRate", "등락률"],
  ["marketCap", "시가총액"],
  ["per", "PER"],
  ["pbr", "PBR"],
  ["roe", "ROE"],
] as const;
type Column = (typeof columns)[number][0];
function display(item: ScreenItem, key: Column) {
  const value = item[key];
  if (value === null) return "—";
  if (key === "price") return formatKRW(Number(value));
  if (key === "marketCap") return formatKRWCompact(Number(value));
  if (key === "changeRate" || key === "roe")
    return formatPercent(Number(value));
  return String(value);
}
export function ResultTable({
  result,
  sort: filterSort,
  isPending = false,
  onSort,
}: {
  result: ScreenResult;
  sort?: ScreenFilter["sort"];
  isPending?: boolean;
  onSort?: (field: FilterField, direction: "asc" | "desc") => void;
}) {
  const [localSort, setLocalSort] = useState<{
    field: Column;
    direction: "asc" | "desc";
  } | null>(null);
  const sort = localSort ??
    filterSort ?? { field: "marketCap", direction: "desc" };
  const [messages, setMessages] = useState<Record<string, string>>({});
  const add = useAddWatchlist();
  const items = [...result.items];
  if (localSort)
    items.sort((a, b) => {
      const left = a[localSort.field],
        right = b[localSort.field];
      if (left === null)
        return right === null ? a.code.localeCompare(b.code) : 1;
      if (right === null) return -1;
      const comparison = ["name", "market"].includes(localSort.field)
        ? String(left).localeCompare(String(right), "ko")
        : Number(left) - Number(right);
      return comparison === 0
        ? a.code.localeCompare(b.code)
        : comparison * (localSort.direction === "asc" ? 1 : -1);
    });
  function sortBy(field: Column) {
    const direction =
      sort?.field === field && sort.direction === "asc" ? "desc" : "asc";
    if (onSort && field !== "name" && field !== "market") {
      setLocalSort(null);
      onSort(field, direction);
    } else {
      setLocalSort({ field, direction });
    }
  }
  function addItem(code: string) {
    add.mutate(code, {
      onSuccess: () => setMessages((prev) => ({ ...prev, [code]: "담았어요" })),
      onError: (error) =>
        setMessages((prev) => ({
          ...prev,
          [code]:
            isApiError(error) && error.status === 409
              ? "이미 있어요"
              : getErrorMessage(error),
        })),
    });
  }
  return (
    <section
      className="min-w-0 space-y-3"
      aria-label="검색 결과"
      aria-busy={isPending}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong>{result.total}개 종목</strong>
        <span>기준일 {result.asOf ?? "없음"}</span>
        {result.source === "mock" && <SampleDataBadge />}
      </div>
      <p className="text-sm text-muted-foreground">
        지표 누락으로 제외된 종목 {result.excludedForMissingData}개 · 최대{" "}
        {result.items.length}개 표시
      </p>
      {result.source === "mock" && <Disclaimer variant="sample" />}
      {!items.length ? (
        <EmptyState
          title={
            result.asOf === null
              ? "종목 데이터가 아직 없습니다"
              : "조건에 맞는 종목이 없어요"
          }
          description={
            result.asOf === null
              ? "관리자: seed-mock 또는 refresh-snapshot으로 데이터를 준비해 주세요."
              : "조건 범위를 넓히거나 없는 지표가 있는지 확인해 주세요."
          }
        />
      ) : (
        <>
          <div className="hidden min-w-0 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map(([key, label]) => (
                    <TableHead
                      key={key}
                      aria-sort={
                        sort?.field === key
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => sortBy(key)}
                      >
                        {label}
                        {sort?.field === key
                          ? sort.direction === "asc"
                            ? " ↑"
                            : " ↓"
                          : " ↕"}
                      </button>
                    </TableHead>
                  ))}
                  <TableHead>관심종목</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.code}>
                    {columns.map(([key]) => (
                      <TableCell key={key}>
                        {key === "name" ? (
                          <>
                            <Link
                              className="underline"
                              href={`/stocks/${encodeURIComponent(item.code)}`}
                            >
                              {item.name}
                            </Link>
                            {item.kind === "etf" && (
                              <Badge className="ml-1" variant="secondary">
                                ETF
                              </Badge>
                            )}
                          </>
                        ) : (
                          display(item, key)
                        )}
                      </TableCell>
                    ))}
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          add.isPending ||
                          ["담았어요", "이미 있어요"].includes(
                            messages[item.code],
                          )
                        }
                        onClick={() => addItem(item.code)}
                      >
                        관심종목 담기
                      </Button>
                      {messages[item.code] && (
                        <p role="status" className="text-xs">
                          {messages[item.code]}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            <label className="block text-sm">
              결과 정렬
              <select
                aria-label="결과 정렬"
                className="ml-2 max-w-full rounded border bg-background p-2"
                disabled={isPending}
                value={
                  columns.some(([field]) => field === sort.field)
                    ? sort.field
                    : ""
                }
                onChange={(e) => sortBy(e.target.value as Column)}
              >
                <option value="" disabled>
                  그 밖의 지표
                </option>
                {columns.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => {
                if (columns.some(([field]) => field === sort.field))
                  sortBy(sort.field as Column);
                else
                  onSort?.(
                    sort.field as FilterField,
                    sort.direction === "asc" ? "desc" : "asc",
                  );
              }}
            >
              정렬 방향 바꾸기
            </Button>
            {items.map((item) => (
              <article
                key={item.code}
                className="min-w-0 rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="break-all font-medium underline"
                    href={`/stocks/${encodeURIComponent(item.code)}`}
                  >
                    {item.name}
                  </Link>
                  {item.kind === "etf" && (
                    <Badge variant="secondary">ETF</Badge>
                  )}
                </div>
                <dl className="my-3 grid grid-cols-2 gap-2 text-sm">
                  {columns.slice(1).map(([key, label]) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="break-all">{display(item, key)}</dd>
                    </div>
                  ))}
                </dl>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    add.isPending ||
                    ["담았어요", "이미 있어요"].includes(messages[item.code])
                  }
                  onClick={() => addItem(item.code)}
                >
                  관심종목 담기
                </Button>
                {messages[item.code] && (
                  <p role="status" className="mt-1 text-sm">
                    {messages[item.code]}
                  </p>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
