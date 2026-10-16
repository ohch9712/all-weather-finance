"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { Disclaimer } from "@/components/common/Disclaimer";
import { useNotes, usePositions, useTrades } from "../hooks";
import type { Filters } from "../types";
import { tradeAmount } from "../utils";
import { JournalMoney } from "./JournalMoney";
import { JournalStats } from "./JournalStats";
import { NoteDialog } from "./NoteDialog";
import { TradeDialog } from "./TradeDialog";
import { NoteCards, Pagination, PeriodFilter, QueryState } from "./Shared";

function Records() {
  const [filters, setFilters] = useState<Filters>({});
  const query = useTrades(filters);
  const sources = { manual: "수동", import: "파일", kiwoom: "키움", toss: "토스" };
  return <div className="space-y-4"><PeriodFilter filters={filters} onChange={setFilters} symbol side /><QueryState pending={query.isPending} error={query.error} empty={query.data?.total === 0} retry={() => void query.refetch()} />
    {query.data && query.data.total > 0 && <><div className="hidden md:block"><table className="w-full table-fixed text-sm"><caption className="sr-only">매매 기록</caption><thead><tr className="border-b text-left">{["날짜", "종목", "구분", "수량", "단가", "금액", "수수료+세금", "출처"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{query.data.items.map(trade => <tr key={trade.id} className="relative border-b hover:bg-muted/40"><td className="break-words p-2">{trade.tradedOn}<p className="text-xs text-muted-foreground">{trade.tradedTime ?? "시각 미상"}</p></td><td className="break-words p-2"><Link href={`/journal/${trade.id}`} className="text-primary underline after:absolute after:inset-0" aria-label={`${trade.symbolName} 거래 상세`}>{trade.symbolName}</Link><p className="text-xs">{trade.symbolCode}</p></td><td className="p-2"><Badge variant={trade.side === "buy" ? "secondary" : "outline"}>{trade.side === "buy" ? "매수" : "매도"}</Badge></td><td className="break-all p-2">{trade.quantity}</td><td className="p-2"><JournalMoney value={trade.price} currency={trade.currency} /></td><td className="p-2"><JournalMoney value={tradeAmount(trade.quantity, trade.price, trade.currency)} currency={trade.currency} /></td><td className="p-2"><JournalMoney value={trade.fee} currency={trade.currency} /> + <JournalMoney value={trade.tax} currency={trade.currency} /></td><td className="p-2">{sources[trade.source]}</td></tr>)}</tbody></table></div>
      <div className="grid gap-3 md:hidden">{query.data.items.map(trade => <Link href={`/journal/${trade.id}`} key={trade.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-muted-foreground">{trade.tradedOn} · {trade.tradedTime ?? "시각 미상"}</span><Badge variant="secondary">{trade.side === "buy" ? "매수" : "매도"}</Badge></div><p className="break-words font-semibold">{trade.symbolName} <span className="text-sm font-normal">{trade.symbolCode}</span></p><p className="break-all text-sm">{trade.quantity}주 × <JournalMoney value={trade.price} currency={trade.currency} /></p><p><JournalMoney value={tradeAmount(trade.quantity, trade.price, trade.currency)} currency={trade.currency} /></p><p className="text-xs text-muted-foreground">수수료 <JournalMoney value={trade.fee} currency={trade.currency} /> + 세금 <JournalMoney value={trade.tax} currency={trade.currency} /> · {sources[trade.source]}</p></Link>)}</div>
      <Pagination data={query.data} onPage={page => setFilters({ ...filters, page })} /></>}
  </div>;
}
function Holdings() {
  const [closed, setClosed] = useState(false);
  const query = usePositions(closed);
  return <div className="space-y-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={closed} onChange={e => setClosed(e.target.checked)} />청산된 종목 포함</label><QueryState pending={query.isPending} error={query.error} empty={query.data?.items.length === 0} retry={() => void query.refetch()} />
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">{query.data?.items.map(item => <article className="min-w-0 space-y-4 rounded-xl border bg-card p-4" key={`${item.market}-${item.symbolCode}-${item.currency}`}><div><h3 className="break-words font-semibold">{item.symbolName}</h3><p className="text-sm text-muted-foreground">{item.market} · {item.symbolCode} · {item.currency}</p></div><dl className="grid grid-cols-2 gap-3 text-sm">{[["보유 수량", `${item.quantity}주`], ["평균단가", <JournalMoney key="avg" value={item.avgCost} currency={item.currency} />], ["매입원가", <JournalMoney key="basis" value={item.costBasis} currency={item.currency} />], ["실현손익", <JournalMoney key="realized" value={item.realizedPnl} currency={item.currency} signed />], ["거래 수", `${item.tradeCount}건`]].map(([label, value]) => <div className="min-w-0" key={String(label)}><dt className="text-muted-foreground">{label}</dt><dd className="break-all font-medium">{value}</dd></div>)}</dl>{item.hasOversold && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">⚠ 기록이 빠진 매수가 있는지 확인해 주세요.</p>}</article>)}</div>
  </div>;
}
function Notes() {
  const [filters, setFilters] = useState<Filters>({});
  const [adding, setAdding] = useState(false);
  const query = useNotes(filters);
  return <div className="space-y-4"><div className="flex justify-end"><Button onClick={() => setAdding(true)}>노트 추가</Button></div><PeriodFilter filters={filters} onChange={setFilters} kind /><QueryState pending={query.isPending} error={query.error} empty={query.data?.total === 0} retry={() => void query.refetch()} />{query.data && <><NoteCards notes={query.data.items} />{query.data.total > 0 && <Pagination data={query.data} onPage={page => setFilters({ ...filters, page })} />}</>}{adding && <NoteDialog onClose={() => setAdding(false)} />}</div>;
}
export function JournalPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const tabs = { records: "기록", positions: "보유", stats: "통계", notes: "노트" };
  const requested = searchParams.get("tab") ?? "records";
  const tab = Object.hasOwn(tabs, requested) ? requested : "records";
  function select(key: string) { const params = new URLSearchParams(searchParams.toString()); params.set("tab", key); router.replace(`/journal?${params}`, { scroll: false }); }
  return <div className="min-w-0 space-y-5"><PageHeader title="매매일지" description="매매를 기록하고, 이동평균법으로 성과를 돌아보세요. 통화별로 따로 계산해요." actions={<><Button variant="outline" asChild><Link href="/journal/import">파일로 가져오기</Link></Button><Button onClick={() => setAdding(true)}>매매 추가</Button></>} />
    <div role="tablist" aria-label="매매일지 메뉴" className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">{Object.entries(tabs).map(([key, label]) => <button role="tab" aria-selected={tab === key} aria-controls={`panel-${key}`} id={`tab-${key}`} key={key} onClick={() => select(key)} className={`rounded-lg px-2 py-2 text-sm ${tab === key ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"}`}>{label}</button>)}</div>
    <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0">{tab === "records" ? <Records /> : tab === "positions" ? <Holdings /> : tab === "stats" ? <JournalStats /> : <Notes />}</section>
    <Disclaimer variant="investment" />{adding && <TradeDialog onClose={() => setAdding(false)} />}
  </div>;
}
