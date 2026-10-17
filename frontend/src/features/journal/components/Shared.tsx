"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState } from "@/components/common/ErrorState";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { getErrorMessage } from "@/lib/api-client";
import { useJournalMutations } from "../hooks";
import type { Filters, Note, Page } from "../types";
import { emotions, kinds } from "../utils";
import { Field, selectClass } from "./Fields";
import { NoteDialog } from "./NoteDialog";

export function PeriodFilter({ filters, onChange, symbol = false, side = false, kind = false }: { filters: Filters; onChange: (filters: Filters) => void; symbol?: boolean; side?: boolean; kind?: boolean }) {
  const set = (key: keyof Filters, value: string) => onChange({ ...filters, [key]: value, page: 1 });
  return <div className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
    <Field label="시작일"><Input type="date" value={filters.from ?? ""} onChange={e => set("from", e.target.value)} /></Field>
    <Field label="종료일"><Input type="date" value={filters.to ?? ""} onChange={e => set("to", e.target.value)} /></Field>
    {symbol && <Field label="종목 검색"><Input value={filters.symbol ?? ""} onChange={e => set("symbol", e.target.value)} placeholder="코드 또는 이름" /></Field>}
    {side && <Field label="매수·매도 필터"><select className={selectClass} value={filters.side ?? ""} onChange={e => set("side", e.target.value)}><option value="">전체</option><option value="buy">매수</option><option value="sell">매도</option></select></Field>}
    {kind && <Field label="노트 종류 필터"><select className={selectClass} value={filters.kind ?? ""} onChange={e => set("kind", e.target.value)}><option value="">전체</option>{Object.entries(kinds).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field>}
  </div>;
}
export function Pagination({ data, onPage }: { data: Pick<Page<unknown>, "total" | "page" | "pageSize">; onPage: (page: number) => void }) {
  return <nav aria-label="목록 페이지" className="flex flex-wrap items-center justify-center gap-3"><Button variant="outline" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>이전</Button><span className="text-sm">{data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} · {data.total}건</span><Button variant="outline" disabled={data.page * data.pageSize >= data.total} onClick={() => onPage(data.page + 1)}>다음</Button></nav>;
}
export function QueryState({ pending, error, empty, retry }: { pending: boolean; error: unknown; empty: boolean; retry: () => void }) {
  if (pending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (empty) return <EmptyState title="아직 기록이 없어요" description="매매나 노트를 추가하면 여기에서 확인할 수 있어요." />;
  return null;
}
export function NoteCards({ notes }: { notes: Note[] }) {
  const [editing, setEditing] = useState<Note | null>(null);
  const mutations = useJournalMutations();
  async function remove(id: string) { try { await mutations.deleteNote.mutateAsync(id); toast.success("노트를 삭제했어요."); } catch (error) { toast.error(getErrorMessage(error)); throw error; } }
  return <><div className="grid min-w-0 gap-4 md:grid-cols-2">{notes.map(note => <article key={note.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{kinds[note.kind]}</Badge><span className="text-sm text-muted-foreground">{note.notedOn}</span>{note.emotion && <Badge variant="outline">{emotions[note.emotion]}</Badge>}</div>
    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{note.content}</p><div className="flex flex-wrap gap-2">{note.tags.map(tag => <Badge key={tag} variant="outline">#{tag}</Badge>)}</div>
    {note.symbolCode && <p className="text-sm">종목 {note.symbolCode}</p>}{note.tradeId && <Link className="text-sm text-primary underline" href={`/journal/${note.tradeId}`}>연결 거래 보기</Link>}
    <div className="flex gap-2"><Button variant="outline" onClick={() => setEditing(note)}>노트 수정</Button><ConfirmDialog title="노트를 삭제할까요?" description="삭제한 노트는 복구할 수 없어요." confirmLabel="노트 삭제" destructive trigger={<Button variant="ghost">노트 삭제</Button>} onConfirm={() => remove(note.id)} /></div>
  </article>)}</div>{editing && <NoteDialog note={editing} onClose={() => setEditing(null)} />}</>;
}
