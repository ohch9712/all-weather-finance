"use client";

import { useState } from "react";
import Link from "next/link";
import { FolderCog, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { Disclaimer } from "@/components/common/Disclaimer";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { SampleDataBadge } from "@/components/common/SampleDataBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StockSearchCombobox } from "@/features/stocks/components/StockSearchCombobox";
import type { StockSummary } from "@/features/stocks/types";
import { formatDateTime } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-client";
import { useWatchlist, useWatchlistMutations } from "../hooks";
import type { WatchlistItem } from "../types";
import { ALL_GROUPS, DEFAULT_GROUP, groupItems, moveWithinGroup } from "../utils";
import { GroupManageDialog } from "./GroupManageDialog";
import { WatchlistEditDialog } from "./WatchlistEditDialog";
import { WatchlistRow } from "./WatchlistRow";

function latestQuoteTime(items: WatchlistItem[]): string | null {
  const times = items.map((item) => item.quote?.asOf).filter((value): value is string => !!value);
  return times.length ? times.reduce((latest, value) => (value > latest ? value : latest)) : null;
}

/** `/stocks/watchlist`: 종목 검색으로 담고 그룹·메모·순서를 관리한다. 화면이 보이는 동안 30초마다 새로 고친다. */
export function WatchlistPage() {
  const watchlist = useWatchlist({ poll: true });
  const { add, reorder, remove } = useWatchlistMutations();
  const [tab, setTab] = useState<string>(ALL_GROUPS);
  const [editing, setEditing] = useState<WatchlistItem | null>(null);
  const [managing, setManaging] = useState(false);

  const data = watchlist.data;
  const items = data?.items ?? [];
  const groups = data?.groups ?? [];
  // 선택한 그룹이 사라지면(이름 변경·삭제) 전체로 돌아간다.
  const activeTab = tab === ALL_GROUPS || groups.includes(tab) ? tab : ALL_GROUPS;
  const visible = activeTab === ALL_GROUPS ? items : items.filter((item) => item.groupName === activeTab);
  const sections = groupItems(visible);
  const isSample = data?.source === "mock" || items.some((item) => item.source === "mock");
  const quoteTime = latestQuoteTime(items);

  function handleSelect(stock: StockSummary) {
    const groupName = activeTab === ALL_GROUPS ? DEFAULT_GROUP : activeTab;
    add.mutate(
      { code: stock.code, groupName, memo: null },
      {
        onSuccess: () => toast.success(`${stock.name}을(를) "${groupName}" 그룹에 담았어요.`),
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  function handleMove(item: WatchlistItem, direction: -1 | 1) {
    const next = moveWithinGroup(items, item.id, direction);
    if (!next) return;
    reorder.mutate(next, { onError: (error) => toast.error(getErrorMessage(error)) });
  }

  async function handleDelete(item: WatchlistItem) {
    try {
      await remove.mutateAsync(item.id);
      toast.success(`${item.name}을(를) 관심종목에서 뺐어요.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="관심종목"
        description="종목을 검색해 담고 그룹·메모·순서를 관리하세요. 시세는 30초마다 새로 고칩니다."
        actions={isSample ? <SampleDataBadge /> : undefined}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <StockSearchCombobox onSelect={handleSelect} label="관심종목에 담을 종목 검색" className="sm:flex-1" />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          disabled={groups.length === 0}
          onClick={() => setManaging(true)}
        >
          <FolderCog aria-hidden="true" />
          그룹 관리
        </Button>
      </div>

      {watchlist.isPending ? (
        <LoadingState rows={4} />
      ) : watchlist.isError ? (
        <ErrorState error={watchlist.error} onRetry={() => watchlist.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="관심종목이 비어 있어요"
          description="위 검색창에 종목명이나 코드를 입력하고 결과를 고르면 관심종목에 담깁니다."
          action={
            <Button variant="outline" asChild>
              <Link href="/stocks/screener">
                <ScanSearch aria-hidden="true" />
                조건검색으로 종목 찾기
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <Tabs value={activeTab} onValueChange={setTab}>
            <TabsList aria-label="관심종목 그룹" className="h-auto flex-wrap justify-start">
              <TabsTrigger value={ALL_GROUPS}>전체 {items.length}</TabsTrigger>
              {groups.map((group) => (
                <TabsTrigger key={group} value={group}>
                  {group} {items.filter((item) => item.groupName === group).length}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="space-y-4" aria-live="polite">
            {sections.map((section) => (
              <section key={section.groupName} aria-label={`${section.groupName} 그룹`} className="space-y-2">
                {activeTab === ALL_GROUPS && (
                  <h2 className="text-sm font-semibold text-muted-foreground">{section.groupName}</h2>
                )}
                <ul className="space-y-2">
                  {section.items.map((item, index) => (
                    <WatchlistRow
                      key={item.id}
                      item={item}
                      canMoveUp={index > 0}
                      canMoveDown={index < section.items.length - 1}
                      busy={reorder.isPending}
                      onMove={(direction) => handleMove(item, direction)}
                      onEdit={() => setEditing(item)}
                      onDelete={() => handleDelete(item)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {quoteTime && <p className="text-xs text-muted-foreground">시세 기준 {formatDateTime(quoteTime)}</p>}
        </>
      )}

      <Disclaimer variant="investment" />

      {editing && <WatchlistEditDialog item={editing} groups={groups} onClose={() => setEditing(null)} />}
      {managing && (
        <GroupManageDialog
          items={items}
          onClose={() => setManaging(false)}
          onRenamed={(from, to) => {
            if (tab === from) setTab(to);
          }}
        />
      )}
    </div>
  );
}
