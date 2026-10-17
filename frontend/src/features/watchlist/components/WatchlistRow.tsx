"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, StickyNote, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { ChangeText, EtfBadge } from "@/features/stocks/components/StockBits";
import { formatPrice, formatRatioPlain, stockHref } from "@/features/stocks/utils";
import { cn } from "@/lib/utils";
import type { WatchlistItem } from "../types";

interface WatchlistRowProps {
  item: WatchlistItem;
  canMoveUp: boolean;
  canMoveDown: boolean;
  busy?: boolean;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

export function WatchlistRow({ item, canMoveUp, canMoveDown, busy = false, onMove, onEdit, onDelete }: WatchlistRowProps) {
  const label = `${item.name}(${item.code})`;
  return (
    <li
      aria-label={label}
      className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:gap-3"
    >
      <Link
        href={stockHref(item.code)}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{item.name}</span>
            <EtfBadge kind={item.kind} />
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {item.code}
            {item.market ? ` · ${item.market}` : ""}
          </span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            PER {formatRatioPlain(item.metrics?.per)} · PBR {formatRatioPlain(item.metrics?.pbr)}
          </span>
          {item.memo && (
            <span className="block truncate text-xs text-muted-foreground" title={item.memo}>
              메모: {item.memo}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold tabular-nums">{formatPrice(item.quote?.price, item.market)}</span>
          <ChangeText rate={item.quote?.changeRate} className="block text-xs" />
        </span>
      </Link>
      <div className="flex shrink-0 items-center justify-end gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={item.memo ? `${item.name} 메모·그룹 편집(메모 있음)` : `${item.name} 메모·그룹 편집`}
          onClick={onEdit}
        >
          <StickyNote className={cn(item.memo && "fill-current")} aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${item.name} 위로 이동`}
          disabled={!canMoveUp || busy}
          onClick={() => onMove(-1)}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${item.name} 아래로 이동`}
          disabled={!canMoveDown || busy}
          onClick={() => onMove(1)}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
        <ConfirmDialog
          title="관심종목에서 뺄까요?"
          description={`${label}을(를) 관심종목에서 뺍니다. 메모도 함께 지워집니다.`}
          confirmLabel="빼기"
          destructive
          onConfirm={onDelete}
          trigger={
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`${item.name} 삭제`}>
              <Trash2 aria-hidden="true" />
            </Button>
          }
        />
      </div>
    </li>
  );
}
