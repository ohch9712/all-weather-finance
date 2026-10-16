"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { Disclaimer } from "@/components/common/Disclaimer";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { getErrorMessage } from "@/lib/api-client";
import { useJournalMutations, useTrade } from "../hooks";
import { JournalMoney } from "./JournalMoney";
import { NoteDialog } from "./NoteDialog";
import { NoteCards, QueryState } from "./Shared";
import { TradeDialog } from "./TradeDialog";
export function TradeDetailPage({ id }: { id: string }) {
  const query = useTrade(id);
  const mutations = useJournalMutations();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const trade = query.data?.trade;
  async function remove() { try { await mutations.deleteTrade.mutateAsync(id); toast.success("매매 기록을 삭제했어요."); router.push("/journal"); } catch (error) { toast.error(getErrorMessage(error)); throw error; } }
  return <div className="min-w-0 space-y-5"><Link href="/journal" className="text-sm text-primary underline">매매일지로 돌아가기</Link><PageHeader title="매매 상세" /><QueryState pending={query.isPending} error={query.error} empty={false} retry={() => void query.refetch()} />
    {trade && query.data && <><section className="min-w-0 space-y-4 rounded-xl border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="break-words text-xl font-semibold">{trade.symbolName}</h2><p className="text-sm text-muted-foreground">{trade.market} · {trade.symbolCode} · {trade.currency}</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => setEditing(true)}>매매 수정</Button><ConfirmDialog title="매매 기록을 삭제할까요?" description="연결된 노트는 독립 노트로 남고, 보유와 손익은 다시 계산돼요." confirmLabel="매매 삭제" destructive trigger={<Button variant="destructive">매매 삭제</Button>} onConfirm={remove} /></div></div>
      <dl className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">날짜·시각</dt><dd>{trade.tradedOn} {trade.tradedTime ?? "시각 미상 (09:00 기준)"}</dd></div><div><dt className="text-muted-foreground">구분·수량</dt><dd className="break-all">{trade.side === "buy" ? "매수" : "매도"} · {trade.quantity}주</dd></div><div><dt className="text-muted-foreground">단가</dt><dd><JournalMoney value={trade.price} currency={trade.currency} /></dd></div><div><dt className="text-muted-foreground">수수료·세금</dt><dd><JournalMoney value={trade.fee} currency={trade.currency} /> · <JournalMoney value={trade.tax} currency={trade.currency} /></dd></div><div><dt className="text-muted-foreground">증권사·계좌 별칭</dt><dd className="break-words">{trade.broker ?? "미입력"} · {trade.accountLabel ?? "미입력"}</dd></div><div><dt className="text-muted-foreground">출처</dt><dd>{{ manual: "수동", import: "파일", kiwoom: "키움", toss: "토스" }[trade.source]}</dd></div></dl>
      {trade.side === "sell" && <p className="text-lg font-semibold">실현손익 <JournalMoney value={query.data.realizedPnl} currency={trade.currency} signed /></p>}
      {query.data.oversold && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">보유보다 많이 매도한 기록이에요. 초과 수량은 손익에서 제외했어요. 기록이 빠진 매수가 있는지 확인해 주세요.</p>}
    </section><section className="space-y-4"><div className="flex items-center justify-between"><h2 className="font-semibold">연결된 노트</h2><Button onClick={() => setAddingNote(true)}>이 거래에 노트 남기기</Button></div><NoteCards notes={query.data.notes} />{query.data.notes.length === 0 && <p className="text-sm text-muted-foreground">매매 이유와 복기를 남겨 보세요.</p>}</section>
    {editing && <TradeDialog trade={trade} onClose={() => setEditing(false)} />}{addingNote && <NoteDialog tradeId={trade.id} symbolCode={trade.symbolCode} onClose={() => setAddingNote(false)} />}</>}
    <Disclaimer variant="investment" />
  </div>;
}
