"use client";

import Link from "next/link";
import { ArrowLeft, NotebookPen, Star } from "lucide-react";
import { toast } from "sonner";
import { Disclaimer } from "@/components/common/Disclaimer";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { SampleDataBadge } from "@/components/common/SampleDataBadge";
import { Button } from "@/components/ui/button";
import { useWatchlist, useWatchlistMutations } from "@/features/watchlist/hooks";
import { DEFAULT_GROUP } from "@/features/watchlist/utils";
import { getErrorMessage, isApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStockDetail } from "../hooks";
import type { StockDetail } from "../types";
import { formatPrice, journalRecordsHref } from "../utils";
import { StockChart } from "./StockChart";
import { StockMetrics } from "./StockMetrics";
import { ChangeText, EtfBadge } from "./StockBits";

function BackLink() {
  return (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <Link href="/stocks/watchlist">
        <ArrowLeft aria-hidden="true" />
        관심종목
      </Link>
    </Button>
  );
}

/** 관심종목 담기·빼기 토글 */
function WatchlistToggle({ stock }: { stock: StockDetail }) {
  const watchlist = useWatchlist();
  const { add, remove } = useWatchlistMutations();
  const item = watchlist.data?.items.find((entry) => entry.code === stock.code);
  const added = !!item;
  const pending = watchlist.isPending || add.isPending || remove.isPending;

  function toggle() {
    if (item) {
      remove.mutate(item.id, {
        onSuccess: () => toast.success("관심종목에서 뺐어요."),
        onError: (error) => toast.error(getErrorMessage(error)),
      });
    } else {
      add.mutate(
        { code: stock.code, groupName: DEFAULT_GROUP, memo: null },
        {
          onSuccess: () => toast.success("관심종목에 담았어요."),
          onError: (error) => toast.error(getErrorMessage(error)),
        },
      );
    }
  }

  return (
    <Button
      type="button"
      variant={added ? "secondary" : "default"}
      aria-pressed={added}
      disabled={pending || watchlist.isError}
      onClick={toggle}
    >
      <Star className={cn(added && "fill-current")} aria-hidden="true" />
      {added ? "관심종목에서 빼기" : "관심종목 담기"}
    </Button>
  );
}

export function StockDetailView({ stock }: { stock: StockDetail }) {
  const price = stock.quote?.price ?? stock.snapshot?.price ?? null;
  const rate = stock.quote?.changeRate ?? stock.snapshot?.changeRate ?? null;
  const asOf = stock.quote ? formatDateTime(stock.quote.asOf) : stock.snapshot?.asOf;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight break-keep sm:text-2xl">{stock.name}</h1>
            <EtfBadge kind={stock.kind} />
            {stock.source === "mock" && <SampleDataBadge />}
          </div>
          <p className="text-sm text-muted-foreground break-keep">
            {stock.code} · {stock.market}
            {stock.sector ? ` · ${stock.sector}` : ""}
          </p>
          <p className="flex flex-wrap items-baseline gap-x-2 pt-1">
            <span className="text-2xl font-bold tabular-nums">{formatPrice(price, stock.market)}</span>
            <ChangeText rate={rate} change={stock.quote?.change} market={stock.market} className="text-sm font-medium" />
          </p>
          {asOf && <p className="text-xs text-muted-foreground">{asOf} 기준</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <WatchlistToggle stock={stock} />
          <Button variant="outline" asChild>
            <Link href={journalRecordsHref(stock.code)}>
              <NotebookPen aria-hidden="true" />내 매매 기록 보기
            </Link>
          </Button>
        </div>
      </header>

      <StockChart code={stock.code} name={stock.name} market={stock.market} />
      <StockMetrics stock={stock} />
      <Disclaimer variant="investment" />
    </div>
  );
}

/** `/stocks/[code]`: 없는 코드는 404 화면 */
export function StockDetailPage({ code }: { code: string }) {
  const detail = useStockDetail(code);
  return (
    <div className="space-y-4">
      <BackLink />
      {detail.isPending ? (
        <LoadingState rows={5} />
      ) : detail.isError ? (
        isApiError(detail.error) && detail.error.status === 404 ? (
          <EmptyState
            title="종목을 찾을 수 없어요"
            description={`"${code}" 종목이 없거나 상장 목록에서 빠졌어요. 종목명으로 다시 검색해 보세요.`}
            action={
              <Button variant="outline" asChild>
                <Link href="/stocks/watchlist">관심종목으로</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        )
      ) : (
        <StockDetailView stock={detail.data} />
      )}
    </div>
  );
}
