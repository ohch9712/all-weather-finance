"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { Disclaimer } from "@/components/common/Disclaimer";
import { getErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useBrokerConnections, useSyncHoldings } from "../hooks";
import type { HoldingSyncResult } from "../types";

export function HoldingSyncDialog({ onClose, initialConnectionId }: { onClose: () => void; initialConnectionId?: string }) {
  const connections = useBrokerConnections();
  const sync = useSyncHoldings();
  const [selection, setSelection] = useState(initialConnectionId ?? "");
  const [result, setResult] = useState<HoldingSyncResult | null>(null);
  const active = connections.data?.filter((item) => item.status === "active") ?? [];
  const selected = active.find((item) => item.id === selection);

  async function execute() {
    if (!selected) return;
    setResult(null);
    try {
      setResult(await sync.mutateAsync(selected.id));
    } catch {
      // 오류는 mutation의 상태로 표시한다.
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !sync.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>증권사 잔고 불러오기</DialogTitle>
          <DialogDescription>현재 잔고와 예수금을 보유 자산에 반영해요. 직접 지정한 자산군은 유지돼요.</DialogDescription>
        </DialogHeader>
        {connections.isPending && <LoadingState rows={2} />}
        {connections.isError && <ErrorState error={connections.error} onRetry={() => connections.refetch()} />}
        {connections.isSuccess && active.length === 0 && <p className="text-sm">활성 증권사 연결이 없어요. <Link href="/settings/connections" className="underline">설정에서 연결하기</Link></p>}
        {active.length > 0 && <div className="space-y-2">
          <Label htmlFor="sync-connection">증권사 연결</Label>
          <select id="sync-connection" value={selection} disabled={sync.isPending} onChange={(event) => { setSelection(event.target.value); setResult(null); sync.reset(); }} className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm">
            <option value="">연결을 선택해 주세요</option>
            {active.map((connection) => <option key={connection.id} value={connection.id}>{connection.label} ({connection.provider === "mock" ? "샘플" : connection.provider === "kiwoom" ? "키움증권" : "토스증권"})</option>)}
          </select>
        </div>}
        {selected?.provider === "mock" && <Disclaimer variant="sample" />}
        {sync.isError && <Alert variant="destructive"><AlertDescription>{getErrorMessage(sync.error)}</AlertDescription></Alert>}
        {result && <div role="status" className="space-y-2 rounded-lg border p-3 text-sm">
          <p>추가 {result.created}개 · 갱신 {result.updated}개 · 삭제 {result.removed}개 · 건너뜀 {result.skipped.length}개</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(result.syncedAt)} 동기화</p>
          {result.skipped.length > 0 && <ul className="space-y-1">{result.skipped.map((item, index) => <li key={index} className="wrap-anywhere">{item.name}: {item.reason}</li>)}</ul>}
        </div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sync.isPending}>닫기</Button>
          <Button onClick={execute} disabled={!selected || sync.isPending}>{sync.isPending ? "불러오는 중…" : "불러오기"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
