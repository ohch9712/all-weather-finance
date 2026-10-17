"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatKRW } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useEntries } from "../hooks";
import type { Entry, EntryFilters } from "../types";
import { PAGE_SIZE, PAYMENT_METHOD_LABEL, SOURCE_LABEL, formatDayHeader, groupByDate } from "../utils";

/** 수입은 `+`와 파란색, 지출은 `-`와 기본 글자색 */
function EntryAmount({ kind, amount, className }: { kind: Entry["kind"]; amount: number; className?: string }) {
  return (
    <span className={cn("tabular-nums", kind === "income" && "text-money-down", className)}>
      {kind === "income" ? "+" : "-"}
      {formatKRW(amount)}
    </span>
  );
}

function EntryRow({ entry, onSelect }: { entry: Entry; onSelect: (entry: Entry) => void }) {
  const title = entry.merchant ?? entry.memo ?? entry.categoryName;
  const source = entry.source === "manual" ? null : SOURCE_LABEL[entry.source];
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(entry)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary">{entry.categoryName}</Badge>
            <span>{PAYMENT_METHOD_LABEL[entry.paymentMethod]}</span>
            {source && (
              <Badge variant="outline" className="h-4 px-1.5 text-[11px]">
                {source}
              </Badge>
            )}
          </span>
        </span>
        <EntryAmount kind={entry.kind} amount={entry.amount} className="shrink-0 text-sm font-semibold" />
        <span className="sr-only">수정</span>
      </button>
    </li>
  );
}

function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  return (
    <nav aria-label="내역 페이지" className="flex items-center justify-center gap-2 pt-2">
      <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft aria-hidden="true" />
        이전
      </Button>
      <span className="min-w-16 text-center text-sm tabular-nums" aria-current="page">
        {page} / {pageCount}
      </span>
      <Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        다음
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}

interface EntryListProps {
  filters: EntryFilters;
  onSelect: (entry: Entry) => void;
}

/** 날짜별로 묶은 내역(날짜 헤더에 그날 합계)과 페이지 버튼. 필터가 바뀌면 1쪽부터 본다. */
export function EntryList({ filters, onSelect }: EntryListProps) {
  const filterKey = JSON.stringify(filters);
  const [pageState, setPageState] = useState({ filterKey, page: 1 });
  const page = pageState.filterKey === filterKey ? pageState.page : 1;
  const { data, error, isPending, isPlaceholderData, refetch } = useEntries({ ...filters, page, pageSize: PAGE_SIZE });

  if (isPending) return <LoadingState rows={4} />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const filtered = Boolean(filters.kind || filters.categoryId || filters.q);
  if (data.total === 0) {
    return (
      <EmptyState
        title={filtered ? "조건에 맞는 내역이 없어요" : "이 달의 내역이 없어요"}
        description={filtered ? "필터를 바꿔 보세요." : "내역 추가 버튼으로 수입·지출을 기록해 보세요."}
      />
    );
  }

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  // 마지막 쪽의 마지막 내역을 지워 빈 쪽이 되면 마지막 쪽으로 옮긴다.
  if (data.items.length === 0 && page > pageCount && !isPlaceholderData) {
    setPageState({ filterKey, page: pageCount });
  }
  return (
    <div className={cn("space-y-4", isPlaceholderData && "opacity-60")} aria-busy={isPlaceholderData}>
      <p className="text-xs text-muted-foreground">총 {data.total.toLocaleString("ko-KR")}건</p>
      {groupByDate(data.items).map((group) => (
        <section key={group.date} aria-label={formatDayHeader(group.date)}>
          <div className="flex items-center justify-between gap-2 border-b pb-1.5">
            <h3 className="text-sm font-medium">{formatDayHeader(group.date)}</h3>
            <p className="flex flex-wrap justify-end gap-x-2 text-xs">
              {group.income > 0 && <EntryAmount kind="income" amount={group.income} />}
              {group.expense > 0 && <EntryAmount kind="expense" amount={group.expense} />}
            </p>
          </div>
          <ul className="mt-1">
            {group.entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      ))}
      {pageCount > 1 && (
        <Pagination page={page} pageCount={pageCount} onChange={(next) => setPageState({ filterKey, page: next })} />
      )}
    </div>
  );
}
