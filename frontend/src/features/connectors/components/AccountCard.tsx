"use client";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useConnectorActions, useConnectorSyncs } from "../hooks";
import type { ConnectorAccount } from "../types";

function dateDefaults() {
  const to = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
  return { from: to.slice(0, 8) + "01", to };
}
export function AccountCard({ account, available }: { account: ConnectorAccount; available: boolean }) {
  const [range, setRange] = useState(dateDefaults);
  const [error, setError] = useState<string | null>(null);
  const actions = useConnectorActions();
  const syncs = useConnectorSyncs(account.id);
  const latest = syncs.data?.items[0];
  const busy = actions.sync.isPending || actions.remove.isPending || latest?.status === "running";
  async function run() {
    setError(null);
    if (account.kind === "card") {
      const days = (Date.parse(range.to) - Date.parse(range.from)) / 86400000;
      if (!range.from || !range.to || !Number.isFinite(days) || days < 0 || days > 91) {
        setError("조회 기간은 시작일 이후 최대 92일입니다."); return;
      }
    }
    try { await actions.sync.mutateAsync({ accountId: account.id, ...(account.kind === "card" ? range : {}) }); }
    catch (cause) { setError(getErrorMessage(cause)); }
  }
  async function remove() {
    setError(null);
    try { await actions.remove.mutateAsync(account.id); }
    catch (cause) { setError(getErrorMessage(cause)); }
  }
  return <Card className="min-w-0">
    <CardHeader><div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{account.kind === "card" ? "카드" : "은행"}</Badge><span>{account.organizationName}</span></div><CardTitle className="break-all">{account.label}</CardTitle></CardHeader>
    <CardContent className="min-w-0 space-y-4 text-sm">
      {account.kind === "card" && <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2"><legend className="mb-2 text-muted-foreground">조회 기간 (최대 92일)</legend><div className="min-w-0 space-y-2"><Label htmlFor={`from-${account.id}`}>시작일</Label><Input className="max-w-full" id={`from-${account.id}`} type="date" value={range.from} onChange={event => setRange({ ...range, from: event.target.value })} /></div><div className="min-w-0 space-y-2"><Label htmlFor={`to-${account.id}`}>종료일</Label><Input className="max-w-full" id={`to-${account.id}`} type="date" value={range.to} onChange={event => setRange({ ...range, to: event.target.value })} /></div></fieldset>}
      {syncs.isPending ? <LoadingState rows={1} /> : syncs.error ? <ErrorState error={syncs.error} onRetry={() => void syncs.refetch()} /> : latest ? <div className="space-y-2 rounded-lg bg-muted p-3" role="status">
        <p>최근 가져오기 · {formatDateTime(latest.startedAt)}</p>
        {latest.status === "running" ? <p>데이터를 가져오는 중입니다.</p> : latest.status === "failed" ? <p className="text-destructive">가져오지 못했습니다. 로그인 방법과 기관 상태를 확인해 다시 시도해 주세요.{latest.errorCode && <span className="ml-1">({latest.errorCode})</span>}</p> : latest.summary && <>
          {"inserted" in latest.summary ? <p>저장 {latest.summary.inserted}건 · 중복 {latest.summary.skippedDuplicates}건 · 실패 {latest.summary.failed}건</p> : <p>추가 {latest.summary.created}건 · 갱신 {latest.summary.updated}건 · 삭제 {latest.summary.removed}건</p>}
          {latest.kind === "card_approvals" && <Link className="inline-block underline underline-offset-4" href={`/ledger/import/review?batch=${latest.id}`}>가계부에서 보기</Link>}
        </>}
      </div> : <p className="text-muted-foreground">아직 가져온 내역이 없어요.</p>}
      {error && <p role="alert" className="break-words text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button onClick={() => void run()} disabled={busy || !available}>{actions.sync.isPending ? "가져오는 중…" : "가져오기"}</Button><ConfirmDialog title="수집 계정을 삭제할까요?" description={account.kind === "bank" ? "연결과 이 연결에서 가져온 현금 자산을 삭제합니다." : "연결을 삭제합니다. 이미 기록한 가계부 내역은 유지됩니다."} confirmLabel="계정 삭제" destructive trigger={<Button variant="ghost" disabled={busy}>삭제</Button>} onConfirm={remove} /></div>
    </CardContent>
  </Card>;
}
