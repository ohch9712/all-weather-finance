"use client";

import { NotebookPen } from "lucide-react";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { JournalSection } from "../types";
import { EMPTY_VALUE, TONE_CLASS, formatRealizedPnl, toneOf } from "../utils";
import { SectionCard, SectionEmpty } from "./SectionCard";

interface JournalCardProps {
  data: JournalSection | null;
  onRetry: () => void;
  retrying: boolean;
}

/** 이번 달 실현손익(통화별), 승률, 보유 종목 수 */
export function JournalCard({ data, onRetry, retrying }: JournalCardProps) {
  return (
    <SectionCard
      title="매매 성과"
      icon={NotebookPen}
      link={{ href: "/journal", label: "매매일지" }}
      failed={data === null}
      onRetry={onRetry}
      retrying={retrying}
    >
      {data && <JournalBody data={data} />}
    </SectionCard>
  );
}

function JournalBody({ data }: { data: JournalSection }) {
  if (data.monthRealizedPnl.length === 0 && data.openPositionCount === 0) {
    return (
      <SectionEmpty
        message="매매 기록이 아직 없어요. 매매일지에 거래를 남겨 보세요."
        action={{ href: "/journal", label: "매매 기록하기" }}
      />
    );
  }
  return (
    <>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">이번 달 실현손익</p>
        {data.monthRealizedPnl.length === 0 ? (
          <p className="text-sm text-muted-foreground">이번 달 매도 기록이 없어요</p>
        ) : (
          <ul className="space-y-0.5">
            {data.monthRealizedPnl.map((item) => (
              <li key={item.currency} className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">{item.currency === "KRW" ? "원화" : "달러"}</span>
                <span
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    TONE_CLASS[toneOf(Number(item.realizedPnl))],
                  )}
                >
                  {formatRealizedPnl(item.currency, item.realizedPnl)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t pt-3">
        <div>
          <dt className="text-xs text-muted-foreground">이번 달 승률</dt>
          <dd className="text-base font-semibold tabular-nums">
            {data.winRate === null ? EMPTY_VALUE : formatPercent(data.winRate, 1)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">보유 종목</dt>
          <dd className="text-base font-semibold tabular-nums">{data.openPositionCount}종목</dd>
        </div>
      </dl>
    </>
  );
}
