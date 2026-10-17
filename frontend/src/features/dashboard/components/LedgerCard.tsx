"use client";

import { Wallet } from "lucide-react";
import { MoneyText } from "@/components/common/MoneyText";
import { Progress } from "@/components/ui/progress";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LedgerSection } from "../types";
import { describeExpenseChange, formatMonthLabel } from "../utils";
import { SectionCard, SectionEmpty } from "./SectionCard";

interface LedgerCardProps {
  data: LedgerSection | null;
  onRetry: () => void;
  retrying: boolean;
}

/** 이번 달 수입·지출·전월 대비와 지출 상위 카테고리 3개 */
export function LedgerCard({ data, onRetry, retrying }: LedgerCardProps) {
  return (
    <SectionCard
      title={data ? `${formatMonthLabel(data.month)} 가계부` : "이번 달 가계부"}
      icon={Wallet}
      link={{ href: "/ledger", label: "가계부" }}
      failed={data === null}
      onRetry={onRetry}
      retrying={retrying}
    >
      {data && <LedgerBody data={data} />}
    </SectionCard>
  );
}

function LedgerBody({ data }: { data: LedgerSection }) {
  if (data.incomeTotal === 0 && data.expenseTotal === 0) {
    return (
      <SectionEmpty
        message="이번 달 기록이 아직 없어요. 수입과 지출을 기록해 보세요."
        action={{ href: "/ledger", label: "기록하러 가기" }}
      />
    );
  }
  const rate = data.expenseChangeRate;
  return (
    <>
      <dl className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">수입</dt>
          <dd className="text-lg font-semibold">
            <MoneyText value={data.incomeTotal} compact />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">지출</dt>
          <dd className="text-lg font-semibold">
            <MoneyText value={data.expenseTotal} compact />
          </dd>
        </div>
      </dl>
      <p
        className={cn(
          "text-sm break-keep",
          rate !== null && rate > 0 ? "text-money-up" : rate !== null && rate < 0 ? "text-money-down" : "text-muted-foreground",
        )}
      >
        {describeExpenseChange(rate)}
      </p>
      {data.topCategories.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">지출 상위 카테고리</p>
          <ul className="space-y-2">
            {data.topCategories.map((item) => (
              <li key={item.name} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    <MoneyText value={item.amount} compact /> · {formatPercent(item.ratio, 1)}
                  </span>
                </div>
                <Progress value={item.ratio} aria-label={`${item.name} 지출 비중 ${formatPercent(item.ratio, 1)}`} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
