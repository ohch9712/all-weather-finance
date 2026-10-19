"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { Disclaimer } from "@/components/common/Disclaimer";
import { SampleDataBadge } from "@/components/common/SampleDataBadge";
import { ImportWizard } from "@/features/imports";
import { getErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useConnections, useSyncStatus, useSyncTrades } from "../hooks";
import { shiftDate, todayKst } from "../utils";
import type { SyncResult } from "../types";

const schema = z.object({ connectionId: z.string().min(1, "연결을 선택해 주세요."), from: z.string().min(1, "시작일을 선택해 주세요."), to: z.string().min(1, "종료일을 선택해 주세요.") }).superRefine((value, ctx) => {
  const days = (Date.parse(value.to) - Date.parse(value.from)) / 86400000;
  if (!Number.isFinite(days) || days < 0 || days >= 90) ctx.addIssue({ code: "custom", path: ["from"], message: "조회 기간은 최대 90일로 선택해 주세요." });
  if (value.to > todayKst()) ctx.addIssue({ code: "custom", path: ["to"], message: "종료일은 오늘까지 선택해 주세요." });
});
const recentStart = () => shiftDate(todayKst(), -29);

export function JournalImportPage() {
  const connections = useConnections(); const status = useSyncStatus(); const sync = useSyncTrades();
  const client = useQueryClient(); const [result, setResult] = useState<SyncResult | null>(null);
  const [message, setMessage] = useState("");
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { connectionId: "", from: recentStart(), to: todayKst() } });
  const active = connections.data?.items.filter(c => c.status === "active") ?? [];
  const connectionId = useWatch({ control: form.control, name: "connectionId" });
  const selected = active.find(c => c.id === connectionId);
  const invalidate = () => { void client.invalidateQueries({ queryKey: ["journal"] }); };
  return <div className="min-w-0 space-y-6">
    <PageHeader title="매매내역 가져오기" description="파일이나 연결한 증권사에서 체결 내역을 가져오세요." actions={<Button variant="outline" asChild><Link href="/journal">매매일지로</Link></Button>} />
    <p className="text-sm text-muted-foreground">종목코드 열이 없으면 커밋 때 종목코드를 찾습니다. 종목명을 정확히 확인해 주세요.</p>
    <ImportWizard kind="journal_trades" title="파일로 가져오기" description="증권사 앱·HTS의 거래내역에서 내보내기를 선택해 CSV 또는 엑셀 파일을 저장한 뒤 올려 주세요. 열을 확인하고 매핑해 주세요." onCommitted={invalidate} />
    <Card className="min-w-0"><CardHeader><CardTitle>증권사에서 불러오기</CardTitle></CardHeader><CardContent className="min-w-0 space-y-4">
      {connections.isPending && <p role="status">연결을 불러오고 있습니다…</p>}
      {connections.error && <p role="alert">{getErrorMessage(connections.error)}</p>}
      {!connections.isPending && !connections.error && active.length === 0 && <p>활성 연결이 없어요. <Link className="text-primary underline" href="/settings/connections">증권사 연결 설정</Link>에서 연결을 확인해 주세요.</p>}
      {active.length > 0 && <form className="min-w-0 space-y-4" onSubmit={form.handleSubmit(async values => {
        setMessage(""); setResult(null);
        try { setResult(await sync.mutateAsync(values)); invalidate(); }
        catch (error) { setMessage(getErrorMessage(error)); }
      })}>
        <div className="space-y-2"><Label htmlFor="sync-connection">증권사 연결</Label><select id="sync-connection" className="w-full min-w-0 rounded-md border bg-background p-2 text-sm" {...form.register("connectionId")}><option value="">연결 선택</option>{active.map(c => <option key={c.id} value={c.id}>{c.label} ({c.provider === "mock" ? "샘플" : c.provider === "kiwoom" ? "키움" : "토스"})</option>)}</select>{form.formState.errors.connectionId && <p role="alert">{form.formState.errors.connectionId.message}</p>}</div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">{(["from", "to"] as const).map(key => <div className="min-w-0 space-y-2" key={key}><Label htmlFor={`sync-${key}`}>{key === "from" ? "시작일" : "종료일"}</Label><Input id={`sync-${key}`} className="min-w-0 max-w-full" type="date" max={todayKst()} {...form.register(key)} />{form.formState.errors[key] && <p role="alert">{form.formState.errors[key]?.message}</p>}</div>)}</div>
        <p className="text-xs text-muted-foreground">최대 90일의 체결 내역을 조회합니다.</p>
        {selected?.provider === "toss" && <p className="text-sm text-muted-foreground">토스증권은 주문 하나를 한 건으로 가져옵니다. 여러 번에 나눠 체결된 주문은 평균 체결가로 합치고, 시간외 종가 주문은 토스가 제공하지 않아 빠집니다.</p>}
        {selected?.provider === "mock" && <><SampleDataBadge /><Disclaimer variant="sample" /></>}
        <Button type="submit" disabled={sync.isPending}>{sync.isPending ? "불러오는 중…" : "불러오기"}</Button>
      </form>}
      {message && <p role="alert" className="break-words text-destructive">{message}</p>}
      {result && <p role="status">삽입 {result.inserted}건 · 갱신 {result.updated}건 · 변화 없음 {result.unchanged}건 · 건너뜀 {result.skippedDuplicates}건</p>}
      {status.error && <p role="alert">{getErrorMessage(status.error)}</p>}
      <ul className="space-y-2 text-sm">{status.data?.items.map(item => <li className="break-words" key={item.connectionId}>{item.label} · 마지막 동기화 {item.lastSyncedAt ? formatDateTime(item.lastSyncedAt) : "없음"} · {item.tradeCount}건</li>)}</ul>
    </CardContent></Card>
    {result && result.costEstimated > 0 && <p className="text-sm">증권사가 수수료·세금을 주지 않아 기본 요율로 추정했어요. <Link className="text-primary underline" href="/settings/trading-costs">수수료·세금 설정</Link>에서 확인해 주세요.</p>}
    <Disclaimer variant="investment" />
  </div>;
}
