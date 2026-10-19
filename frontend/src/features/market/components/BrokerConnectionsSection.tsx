"use client";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Disclaimer } from "@/components/common/Disclaimer";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { SampleDataBadge } from "@/components/common/SampleDataBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { brokerErrors } from "../errors";
import { useConnectionActions, useConnections, useEgressIp, useSnapshotStatus } from "../hooks";
import { AutoSyncSetting } from "./AutoSyncSetting";
import { ConnectionForm } from "./ConnectionForm";

const providers = { kiwoom: "키움증권", toss: "토스증권", mock: "샘플 증권사" };
const statuses = { unverified: "미확인", active: "정상", error: "오류" };

export function BrokerConnectionsSection({ allowMock = false }: { allowMock?: boolean }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const connections = useConnections();
  const snapshot = useSnapshotStatus();
  const egress = useEgressIp();
  const actions = useConnectionActions();
  const busy = actions.verify.isPending || actions.remove.isPending;
  // 응답을 받으면(IP·null 모두) 이 화면에 머무는 동안 다시 부르지 않는다. 요청 자체가 실패했을 때만 다시 누를 수 있다.
  const egressIp = egress.isIdle ? "버튼을 누르면 확인합니다" : egress.isPending ? "확인 중…" : egress.data?.ip ?? "확인할 수 없음";

  async function verify(id: string) {
    setActionError(null);
    try {
      const result = await actions.verify.mutateAsync(id);
      if (result.status === "active") toast.success("증권사 연결을 확인했습니다.");
    } catch (error) { setActionError(getErrorMessage(error)); }
  }
  async function remove(id: string) {
    setActionError(null);
    try {
      await actions.remove.mutateAsync(id);
      toast.success("연결을 삭제했습니다.");
    } catch (error) { setActionError(getErrorMessage(error)); }
  }

  return (
    <section aria-labelledby="broker-heading" className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="broker-heading" className="text-xl font-semibold">증권사 연결</h2>
        <Button onClick={() => setOpen(true)}>연결 추가</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>조회 전용으로 안전하게 연결해요</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm break-words">
          <p>증권사 연동은 조회만 합니다. 주문은 할 수 없습니다.</p>
          <p>키움·토스 포털에서 이 서버의 IP를 허용 IP로 등록해야 연결됩니다.</p>
          <div className="flex flex-wrap items-center gap-2">
            <p>서버 공인 IP: <strong>{egressIp}</strong></p>
            <Button variant="outline" size="sm" disabled={egress.isPending || egress.isSuccess} onClick={() => egress.mutate()}>서버 공인 IP 확인</Button>
          </div>
          <p className="text-muted-foreground">IP를 확인할 수 없으면 서버 관리자에게 공인 IP를 확인하세요.</p>
          <p><a className="underline underline-offset-4" href="https://openapi.kiwoom.com/" target="_blank" rel="noreferrer">키움 REST API 포털</a>의 API 사용 등록에서 앱키와 허용 IP를 관리하세요.</p>
          <p><a className="underline underline-offset-4" href="https://developers.tossinvest.com/" target="_blank" rel="noreferrer">토스증권 Open API 안내</a> · 토스 WTS 설정 → Open API → 허용 IP 관리</p>
          <p className="text-muted-foreground">키와 시크릿은 암호화해 저장하며, 저장 후에는 끝 4자리만 보여 줍니다.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>시장 데이터 상태</CardTitle></CardHeader>
        <CardContent>
          {snapshot.isPending ? <LoadingState rows={1} /> : snapshot.error ? <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} /> : snapshot.data && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {snapshot.data.source === "mock" ? <SampleDataBadge /> : <Badge variant="outline">{snapshot.data.source ? providers[snapshot.data.source] : "데이터 없음"}</Badge>}
              <span>기준일 {snapshot.data.asOf ? formatDate(snapshot.data.asOf) : "없음"}</span><span>종목 {snapshot.data.count.toLocaleString("ko-KR")}개</span>
            </div>
          )}
        </CardContent>
      </Card>
      {saved && <p role="status" className="rounded-lg bg-muted p-3 text-sm">저장했습니다. 아래의 ‘연결 확인’ 버튼으로 연결 상태를 확인해 주세요.</p>}
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      {connections.isPending ? <LoadingState /> : connections.error ? <ErrorState error={connections.error} onRetry={() => void connections.refetch()} /> : !connections.data?.items.length ? (
        <EmptyState title="아직 연결한 증권사가 없어요" description="앱키를 등록하고 연결을 확인해 보세요." />
      ) : <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {connections.data.items.map((connection) => (
          <Card key={connection.id} className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={connection.status === "error" ? "destructive" : "outline"}>{statuses[connection.status]}</Badge>
                <span className="text-sm text-muted-foreground">{providers[connection.provider]} · {connection.environment === "real" ? "실전" : "모의"}</span>
                {connection.provider === "mock" && <SampleDataBadge />}
              </div>
              <CardTitle className="break-all">{connection.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="break-all">앱키 {connection.appKeyMasked ?? "없음"}</p>
              <p className="break-all">계좌 {connection.accountNoMasked ?? "미입력"}</p>
              <p>마지막 확인 {connection.lastVerifiedAt ? formatDateTime(connection.lastVerifiedAt) : "아직 확인하지 않음"}</p>
              {connection.lastErrorCode && <p role="alert" className="break-keep text-destructive">{brokerErrors[connection.lastErrorCode] ?? "연결을 다시 확인해 주세요."}</p>}
              {connection.provider !== "mock" && <AutoSyncSetting connection={connection} />}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy} onClick={() => void verify(connection.id)}>{actions.verify.isPending && actions.verify.variables === connection.id ? "확인 중…" : "연결 확인"}</Button>
                <ConfirmDialog title="증권사 연결을 삭제할까요?" description={`${connection.label} 연결과 저장한 자격증명을 삭제합니다.`} confirmLabel="연결 삭제" destructive trigger={<Button variant="ghost" disabled={busy}>삭제</Button>} onConfirm={() => remove(connection.id)} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>}
      <Disclaimer variant="investment" />
      {snapshot.data?.source === "mock" && <Disclaimer variant="sample" />}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>증권사 연결 추가</DialogTitle><DialogDescription>조회용 자격증명을 입력하세요. 저장 후 연결을 확인할 수 있습니다.</DialogDescription></DialogHeader>
          {open && <ConnectionForm allowMock={allowMock} onSaved={() => { setOpen(false); setSaved(true); }} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
