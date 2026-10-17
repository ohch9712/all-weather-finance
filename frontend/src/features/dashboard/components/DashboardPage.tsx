"use client";

import { Disclaimer } from "@/components/common/Disclaimer";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { useDashboardSummary } from "../hooks";
import type { DashboardSummary } from "../types";
import { formatTodayKst, isChecklistComplete } from "../utils";
import { AllocationCard } from "./AllocationCard";
import { ChatCard } from "./ChatCard";
import { ChecklistCard } from "./ChecklistCard";
import { EstateCard } from "./EstateCard";
import { JournalCard } from "./JournalCard";
import { LearnCard } from "./LearnCard";
import { LedgerCard } from "./LedgerCard";
import { WatchlistCard } from "./WatchlistCard";

/** `/` 홈: 인사, 시작 체크리스트, 모듈별 카드. 데이터는 `GET /api/dashboard/summary` 하나로 받는다. */
export function DashboardPage() {
  const summary = useDashboardSummary();

  if (summary.isPending) {
    return <LoadingState rows={4} />;
  }
  if (summary.isError) {
    return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  }
  return (
    <DashboardContent
      data={summary.data}
      onRetry={() => void summary.refetch()}
      retrying={summary.isFetching}
    />
  );
}

interface DashboardContentProps {
  data: DashboardSummary;
  onRetry: () => void;
  retrying: boolean;
}

function DashboardContent({ data, onRetry, retrying }: DashboardContentProps) {
  const section = { onRetry, retrying };
  return (
    <div className="space-y-6">
      <PageHeader title={`안녕하세요, ${data.greetingName}님`} description={formatTodayKst()} />
      {!isChecklistComplete(data.checklist) && <ChecklistCard items={data.checklist} />}
      <div data-testid="dashboard-grid" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AllocationCard data={data.allocation} {...section} />
        <LedgerCard data={data.ledger} {...section} />
        <JournalCard data={data.journal} {...section} />
        <WatchlistCard data={data.watchlist} {...section} />
        <EstateCard data={data.estate} {...section} />
        <LearnCard data={data.learn} {...section} />
        <ChatCard data={data.chat} />
      </div>
      <Disclaimer variant="investment" />
    </div>
  );
}
