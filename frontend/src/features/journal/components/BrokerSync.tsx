"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SampleDataBadge } from "@/components/common/SampleDataBadge";
import { getErrorMessage } from "@/lib/api-client";
import { useConnections, useSyncTrades } from "../hooks";
import type { BrokerConnection, SyncResult } from "../types";
import { shiftDate, todayKst } from "../utils";

// 20의 자동 동기화와 같은 최근 7일(오늘 포함)을 불러온다. 더 긴 기간은 가져오기 화면에서 고른다.
const RECENT_DAYS = 7;

type SyncLine = { connection: BrokerConnection; result: SyncResult; error?: undefined } | { connection: BrokerConnection; result?: undefined; error: string };
export type BrokerSyncOutcome = { kind: "empty" } | { kind: "error"; message: string } | { kind: "done"; from: string; to: string; lines: SyncLine[] };

function monthDay(date: string) { const [, month, day] = date.split("-"); return `${Number(month)}월 ${Number(day)}일`; }

/** 매매일지 머리의 "증권사 동기화" 버튼과 결과 영역이 함께 쓰는 상태. 활성 연결을 목록 순서대로 하나씩 동기화한다. */
export function useBrokerSync() {
  const connections = useConnections();
  const sync = useSyncTrades();
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<BrokerSyncOutcome | null>(null);
  async function run() {
    setRunning(true); setOutcome(null);
    try {
      let items = connections.data?.items;
      if (!items) {
        // 연결 목록을 불러오지 못했으면 누를 때 한 번 더 불러온다.
        const refreshed = await connections.refetch();
        if (!refreshed.data) { setOutcome({ kind: "error", message: getErrorMessage(refreshed.error) }); return; }
        items = refreshed.data.items;
      }
      const active = items.filter(connection => connection.status === "active");
      if (active.length === 0) { setOutcome({ kind: "empty" }); return; }
      const to = todayKst(); const from = shiftDate(to, 1 - RECENT_DAYS);
      const lines: SyncLine[] = [];
      // 성공하면 useSyncTrades가 매매일지 쿼리(목록·보유·통계·동기화 상태)를 무효화한다. 한 연결이 실패해도 다음 연결을 계속한다.
      for (const connection of active) {
        try { lines.push({ connection, result: await sync.mutateAsync({ connectionId: connection.id, from, to }) }); }
        catch (error) { lines.push({ connection, error: getErrorMessage(error) }); }
      }
      setOutcome({ kind: "done", from, to, lines });
    } finally { setRunning(false); }
  }
  return { run, running, disabled: running || connections.isPending, outcome };
}
export type BrokerSyncState = ReturnType<typeof useBrokerSync>;

export function BrokerSyncButton({ sync }: { sync: BrokerSyncState }) {
  return <Button variant="outline" disabled={sync.disabled} onClick={() => void sync.run()}>{sync.running ? "동기화 중…" : "증권사 동기화"}</Button>;
}

export function BrokerSyncResult({ outcome }: { outcome: BrokerSyncOutcome | null }) {
  const link = "text-primary underline";
  return <div role="status" aria-label="증권사 동기화 결과" className="min-w-0">{outcome && <div className="min-w-0 space-y-2 rounded-xl border bg-card p-4 text-sm">
    {outcome.kind === "error" && <p className="break-words text-destructive">{outcome.message}</p>}
    {outcome.kind === "empty" && <p>동기화할 증권사 연결이 없습니다. <Link className={link} href="/settings/connections">증권사 연결 설정</Link></p>}
    {outcome.kind === "done" && <>
      <ul className="space-y-1">{outcome.lines.map(({ connection, result, error }) => <li key={connection.id} className="flex min-w-0 flex-wrap items-center gap-2">
        <span className={`min-w-0 [overflow-wrap:anywhere] ${result ? "" : "text-destructive"}`}>{connection.label}: {result ? `추가 ${result.inserted}건 · 갱신 ${result.updated}건 · 변화 없음 ${result.unchanged}건 · 건너뜀 ${result.skippedDuplicates}건` : error}</span>
        {connection.provider === "mock" && <SampleDataBadge />}
      </li>)}</ul>
      <p className="text-muted-foreground">최근 {RECENT_DAYS}일({monthDay(outcome.from)}~{monthDay(outcome.to)})을 불러왔습니다. 더 긴 기간은 <Link className={link} href="/journal/import">가져오기</Link>에서 고를 수 있습니다.</p>
      {outcome.lines.some(line => (line.result?.costEstimated ?? 0) > 0) && <p>증권사가 수수료·세금을 주지 않아 기본 요율로 추정했어요. <Link className={link} href="/settings/trading-costs">수수료·세금 설정</Link>에서 확인해 주세요.</p>}
    </>}
  </div>}</div>;
}
