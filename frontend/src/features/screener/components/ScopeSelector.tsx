"use client";
import { getErrorMessage } from "@/lib/api-client";
import { useWatchlistGroups } from "../hooks";
import type { ScreenFilter } from "../types";

const selectClass =
  "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";

// 검색 범위(스펙 13 4.0·9절): 전체 종목 또는 내 관심종목(그룹 선택)
export function ScopeSelector({
  filter,
  onChange,
}: {
  filter: ScreenFilter;
  onChange: (f: ScreenFilter) => void;
}) {
  const watchlist = filter.universe === "watchlist";
  const groups = useWatchlistGroups(watchlist);
  const options = [...(groups.data ?? [])];
  // 자연어 해석·링크로 들어온 그룹이 내 목록에 없어도 선택 상태를 그대로 보여 준다.
  if (filter.watchlistGroup && !options.includes(filter.watchlistGroup))
    options.push(filter.watchlistGroup);
  return (
    <div className="space-y-2">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="min-w-0 space-y-1 text-sm">
          검색 범위
          <select
            aria-label="검색 범위"
            className={selectClass}
            value={filter.universe}
            onChange={(event) =>
              onChange({
                ...filter,
                universe: event.target.value as ScreenFilter["universe"],
                watchlistGroup: null,
              })
            }
          >
            <option value="all">전체 종목</option>
            <option value="watchlist">내 관심종목</option>
          </select>
        </label>
        {watchlist && (
          <label className="min-w-0 space-y-1 text-sm">
            관심종목 그룹
            <select
              aria-label="관심종목 그룹"
              className={selectClass}
              value={filter.watchlistGroup ?? ""}
              onChange={(event) =>
                onChange({
                  ...filter,
                  watchlistGroup: event.target.value || null,
                })
              }
            >
              <option value="">모든 그룹</option>
              {options.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {watchlist && (
        <p className="text-xs text-muted-foreground">
          내 관심종목에 담은 종목 안에서만 찾아요. 관심종목 목록은 AI로 보내지
          않아요.
        </p>
      )}
      {watchlist && groups.isPending && (
        <p role="status" className="text-xs">
          관심종목 그룹을 불러오는 중이에요.
        </p>
      )}
      {watchlist && groups.error && (
        <p role="alert" className="text-xs text-destructive">
          관심종목 그룹을 불러오지 못했어요. {getErrorMessage(groups.error)}
        </p>
      )}
    </div>
  );
}
