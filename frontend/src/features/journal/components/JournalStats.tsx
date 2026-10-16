"use client";
import { useState } from "react";
import Link from "next/link";
import { BarChart } from "@/components/charts/BarChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStats } from "../hooks";
import type { Currency, Filters, TradeStats } from "../types";
import { decimalMoney, todayKst } from "../utils";
import { Field, selectClass } from "./Fields";
import { JournalMoney } from "./JournalMoney";
import { PeriodFilter, QueryState } from "./Shared";

export function PnlCalendar({ daily, currency }: { daily: TradeStats["daily"]; currency: Currency }) {
  const [month, setMonth] = useState(todayKst().slice(0, 7));
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const offset = new Date(year, monthNumber - 1, 1).getDay();
  const values = new Map(daily.filter(item => item.currency === currency).map(item => [item.date, item.realizedPnl]));
  const max = Math.max(1, ...Array.from(values.values()).map(value => Math.abs(Number(value))));
  const move = (amount: number) => { const date = new Date(year, monthNumber - 1 + amount, 1); setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`); };
  return <section className="min-w-0 space-y-3 rounded-xl border p-4"><h3 className="font-semibold">일별 손익 달력</h3><div className="flex flex-wrap items-end gap-2"><Button aria-label="이전 달" variant="outline" onClick={() => move(-1)}>←</Button><div className="min-w-0 flex-1"><Field label="달력 월"><Input type="month" value={month} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }} /></Field></div><Button aria-label="다음 달" variant="outline" onClick={() => move(1)}>→</Button></div>
    <p className="text-xs text-muted-foreground">수익: 빨강 · 손실: 파랑 · 진할수록 손익 금액이 커요.</p>
    <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label={`${month} 일별 실현손익`}>
      {["일", "월", "화", "수", "목", "금", "토"].map(day => <div role="columnheader" key={day}>{day}</div>)}
      {Array.from({ length: offset }, (_, i) => <div key={`empty-${i}`} aria-hidden />)}
      {Array.from({ length: days }, (_, i) => { const day = i + 1; const date = `${month}-${String(day).padStart(2, "0")}`; const value = values.get(date); const number = Number(value ?? 0); return <div role="gridcell" key={date} data-pnl={number > 0 ? "profit" : number < 0 ? "loss" : "neutral"} aria-label={`${date} ${value ? decimalMoney(value, currency) : "손익 없음"}`} title={value ? decimalMoney(value, currency) : "손익 없음"} className="flex min-h-14 min-w-0 flex-col justify-center rounded border p-0.5" style={{ backgroundColor: number ? `color-mix(in oklch, var(${number > 0 ? "--money-up" : "--money-down"}) ${Math.round(12 + Math.abs(number) / max * 50)}%, transparent)` : undefined }}><span>{day}</span>{value && <span className={number > 0 ? "text-money-up" : number < 0 ? "text-money-down" : ""}>{number > 0 ? "+" : number < 0 ? "−" : "="}</span>}</div>; })}
    </div>
  </section>;
}
export function JournalStats() {
  const [filters, setFilters] = useState<Filters>({});
  const [currency, setCurrency] = useState<Currency>("KRW");
  const query = useStats(filters);
  const summary = query.data?.byCurrency.find(item => item.currency === currency);
  return <div className="space-y-5"><PeriodFilter filters={filters} onChange={setFilters} /><div className="max-w-xs"><Field label="통계 통화"><select className={selectClass} value={currency} onChange={e => setCurrency(e.target.value as Currency)}><option value="KRW">KRW (원)</option><option value="USD">USD ($)</option></select></Field></div>
    <QueryState pending={query.isPending} error={query.error} empty={!summary} retry={() => void query.refetch()} />
    {query.data && summary && <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["실현손익", summary.realizedPnl], ["평균 수익", summary.avgWin], ["평균 손실", summary.avgLoss]].map(([label, value]) => <div className="min-w-0 rounded-xl border p-4" key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold"><JournalMoney value={value} currency={currency} signed /></p></div>)}<div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">승률</p><p className="mt-2 text-xl font-semibold">{summary.winRate === null ? "—" : `${summary.winRate}%`}</p><p className="text-xs text-muted-foreground">{summary.winCount}승 · {summary.lossCount}패 · 매도 {summary.sellCount}건</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2">{[["최고 거래", summary.bestTrade], ["최악 거래", summary.worstTrade]].map(([label, performance]) => { const item = performance as typeof summary.bestTrade; return <section key={String(label)} className="min-w-0 space-y-2 rounded-xl border p-4"><h3 className="font-medium">{String(label)}</h3>{item ? <><Link className="text-primary underline" href={`/journal/${item.tradeId}`}>{item.symbolName}</Link><p>{item.tradedOn} · <JournalMoney value={item.realizedPnl} currency={currency} signed /></p></> : <p>계산 가능한 매도가 없어요.</p>}</section>; })}</div>
      <section className="min-w-0 rounded-xl border p-4"><h3 className="mb-4 font-semibold">월별 실현손익</h3><BarChart data={query.data.monthly.filter(item => item.currency === currency).map(item => ({ month: item.month, profit: Math.max(0, Number(item.realizedPnl)), loss: Math.min(0, Number(item.realizedPnl)) }))} xKey="month" series={[{ key: "profit", label: "수익", color: "var(--money-up)" }, { key: "loss", label: "손실", color: "var(--money-down)" }]} valueFormatter={value => decimalMoney(String(value), currency)} ariaLabel="월별 실현손익" /></section>
      <PnlCalendar daily={query.data.daily} currency={currency} />
      <section className="space-y-3"><h3 className="font-semibold">종목별 성과</h3><div className="grid gap-3 sm:grid-cols-2">{query.data.bySymbol.filter(item => item.currency === currency).map((item, index) => <div key={`${item.symbolCode}-${index}`} className="min-w-0 rounded-xl border p-4"><p className="font-medium break-words">{item.symbolName} <span className="text-sm text-muted-foreground">{item.symbolCode}</span></p><p><JournalMoney value={item.realizedPnl} currency={currency} signed /> · 매도 {item.sellCount}건</p></div>)}</div></section>
    </>}
  </div>;
}
