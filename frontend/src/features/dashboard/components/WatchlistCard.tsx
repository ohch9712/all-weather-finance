"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import { SampleDataBadge } from "@/components/common/SampleDataBadge";
import { cn } from "@/lib/utils";
import type { WatchlistSection } from "../types";
import { TONE_CLASS, formatChangeRate, formatPrice, stockHref, toneOf } from "../utils";
import { SectionCard, SectionEmpty } from "./SectionCard";

interface WatchlistCardProps {
  data: WatchlistSection | null;
  onRetry: () => void;
  retrying: boolean;
}

const TONE_LABEL = { up: "상승", down: "하락", flat: "보합" } as const;

/** 관심종목 앞 5개 미니 목록(등락 색). Mock 시세면 샘플 배지를 붙인다. */
export function WatchlistCard({ data, onRetry, retrying }: WatchlistCardProps) {
  return (
    <SectionCard
      title="관심종목"
      icon={Star}
      link={{ href: "/stocks/watchlist", label: "더 보기" }}
      badge={data?.source === "mock" ? <SampleDataBadge /> : undefined}
      failed={data === null}
      onRetry={onRetry}
      retrying={retrying}
    >
      {data && <WatchlistBody data={data} />}
    </SectionCard>
  );
}

function WatchlistBody({ data }: { data: WatchlistSection }) {
  if (data.items.length === 0) {
    return (
      <SectionEmpty
        message="관심 있는 종목을 담아 두면 여기서 시세를 볼 수 있어요."
        action={{ href: "/stocks/watchlist", label: "관심종목 담기" }}
      />
    );
  }
  return (
    <ul className="-mx-2 divide-y">
      {data.items.map((item) => {
        const tone = toneOf(item.changeRate);
        return (
          <li key={item.code}>
            <Link
              href={stockHref(item.code)}
              aria-label={`${item.name}(${item.code})`}
              className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">{item.code}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-medium tabular-nums">{formatPrice(item.price)}</span>
                <span className={cn("block text-xs tabular-nums", TONE_CLASS[tone])} data-tone={tone}>
                  {item.changeRate !== null && <span className="sr-only">{TONE_LABEL[tone]} </span>}
                  {formatChangeRate(item.changeRate)}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
