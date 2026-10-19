"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { brokerErrorMessage, brokerErrors } from "../errors";
import { useConnectionActions } from "../hooks";
import type { Connection } from "../types";

const results = { ok: "성공", partial: "일부 실패", failed: "실패" };
const formatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});

export function AutoSyncSetting({ connection }: { connection: Connection }) {
  const { update } = useConnectionActions();
  const [error, setError] = useState<string | null>(null);
  async function change(autoSync: boolean) {
    setError(null);
    try {
      await update.mutateAsync({ id: connection.id, autoSync });
    } catch (error) { setError(brokerErrorMessage(error)); }
  }
  const parts = connection.lastAutoSyncAt ? formatter.formatToParts(new Date(connection.lastAutoSyncAt)) : [];
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return (
    <div className="min-w-0 space-y-2 border-t pt-3 break-words">
      <label className="flex items-center justify-between gap-3">
        자동 동기화
        <Switch aria-label="자동 동기화" checked={connection.autoSync} disabled={update.isPending} onCheckedChange={(value) => void change(value)} />
      </label>
      <p className="text-muted-foreground">평일 오후 8시 30분에 잔고를 자산 현황에, 최근 7일 체결을 매매일지에 반영합니다. 저장된 키로 서버가 조회하며, 끄면 바로 멈춥니다.</p>
      {connection.provider === "toss" && <p className="text-muted-foreground">같은 토스 키를 다른 프로그램에서도 쓰면, 자동 동기화가 토큰을 새로 받을 때 그 프로그램의 연결이 끊길 수 있습니다.</p>}
      {connection.lastAutoSyncAt && connection.lastAutoSyncStatus && <p>마지막 자동 동기화 {part("month")}월 {part("day")}일 {part("hour")}:{part("minute")} · {results[connection.lastAutoSyncStatus]}</p>}
      {connection.lastAutoSyncStatus && connection.lastAutoSyncStatus !== "ok" && connection.lastAutoSyncErrorCode && <p role="alert" className="text-destructive">{brokerErrors[connection.lastAutoSyncErrorCode] ?? "연결을 다시 확인해 주세요."}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  );
}
