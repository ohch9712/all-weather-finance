"use client";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { useJournalMutations, useTrades } from "../hooks";
import type { Note } from "../types";
import { emotions, kinds, todayKst } from "../utils";
import { Field, selectClass } from "./Fields";
const schema = z.object({
  kind: z.enum(["plan", "review", "memo"]), notedOn: z.string().min(1, "날짜를 입력해 주세요."),
  content: z.string().min(1, "내용을 입력해 주세요.").max(5000, "5,000자까지 입력할 수 있어요."),
  tags: z.string(), emotion: z.enum(["", "confident", "calm", "anxious", "impulsive", "greedy", "fearful", "regret"]),
  symbolCode: z.string().refine(v => !v || /^[a-zA-Z0-9.-]{1,20}$/.test(v), "종목코드를 확인해 주세요."), tradeId: z.string(),
});
type Values = z.infer<typeof schema>;
export function NoteDialog({ note, tradeId, symbolCode, onClose }: { note?: Note; tradeId?: string; symbolCode?: string; onClose: () => void }) {
  const mutations = useJournalMutations();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const trades = useTrades({ symbol: search, page });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: note ? { ...note, tags: note.tags.join(", "), emotion: note.emotion ?? "", symbolCode: note.symbolCode ?? "", tradeId: note.tradeId ?? "" } : { kind: "memo", notedOn: todayKst(), content: "", tags: "", emotion: "", symbolCode: symbolCode ?? "", tradeId: tradeId ?? "" } });
  async function submit(values: Values) {
    setError(null);
    const tags = [...new Set(values.tags.split(",").map(v => v.trim()).filter(Boolean))];
    if (tags.length > 10 || tags.some(v => v.length > 20)) { form.setError("tags", { message: "태그는 20자 이하, 최대 10개예요." }); return; }
    try {
      await mutations.saveNote.mutateAsync({ id: note?.id, data: { ...values, tags, emotion: values.emotion || null, symbolCode: values.symbolCode || null, tradeId: values.tradeId || null } });
      toast.success("노트를 저장했어요."); onClose();
    } catch (error) {
      const result = toSubmitErrors(error, Object.keys(schema.shape) as (keyof Values)[]);
      applyFieldErrors(form.setError, result.fieldErrors); setError(result.formError);
    }
  }
  const selected = useWatch({ control: form.control, name: "tradeId" });
  return <Dialog open onOpenChange={open => { if (!open && !form.formState.isSubmitting) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogTitle>{note ? "노트 수정" : "노트 추가"}</DialogTitle><DialogDescription>매매 계획이나 복기를 남겨 보세요. 거래 연결은 선택 사항이에요.</DialogDescription><form onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="종류"><select className={selectClass} {...form.register("kind")}>{Object.entries(kinds).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field><Field label="노트 날짜" error={form.formState.errors.notedOn?.message}><Input type="date" {...form.register("notedOn")} /></Field></div>
    <Field label="내용" error={form.formState.errors.content?.message}><Textarea rows={5} {...form.register("content")} /></Field>
    <Field label="태그 (쉼표로 구분)" error={form.formState.errors.tags?.message}><Input {...form.register("tags")} /></Field>
    <Field label="감정"><select className={selectClass} {...form.register("emotion")}><option value="">선택 안 함</option>{Object.entries(emotions).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field>
    <Field label="연결 종목코드" error={form.formState.errors.symbolCode?.message}><Input {...form.register("symbolCode")} /></Field>
    <Field label="거래 찾기"><Input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="종목코드 또는 이름" /></Field>
    <Field label="연결 거래" error={form.formState.errors.tradeId?.message}><select className={selectClass} {...form.register("tradeId")}><option value="">독립 노트</option>{selected && !trades.data?.items.some(t => t.id === selected) && <option value={selected}>현재 연결 거래</option>}{trades.data?.items.map(t => <option key={t.id} value={t.id}>{t.tradedOn} {t.symbolName} {t.side === "buy" ? "매수" : "매도"} {t.quantity}주</option>)}</select></Field>
    {trades.isError && <p role="alert">거래 목록을 불러오지 못했어요.</p>}
    <div className="flex gap-2"><Button type="button" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>이전 거래</Button><Button type="button" variant="outline" disabled={!trades.data || page * trades.data.pageSize >= trades.data.total} onClick={() => setPage(page + 1)}>다음 거래</Button></div>
    <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "저장 중…" : "노트 저장"}</Button>
  </form></DialogContent></Dialog>;
}
