"use client";
import { useState } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { useJournalMutations } from "../hooks";
import type { Trade, TradeInput } from "../types";
import { todayKst } from "../utils";
import { Field, selectClass } from "./Fields";

const positive = z.string().regex(/^\d+(\.\d{1,6})?$/, "소수 6자리까지 입력해 주세요.").refine(v => Number(v) > 0, "0보다 큰 값을 입력해 주세요.");
const nonnegative = z.string().regex(/^\d+(\.\d{1,6})?$/, "0 이상, 소수 6자리까지 입력해 주세요.");
const schema = z.object({
  tradedOn: z.string().min(1, "날짜를 입력해 주세요.").refine(v => v >= "2000-01-01" && v <= todayKst(), "거래 날짜를 확인해 주세요."),
  tradedTime: z.string(), market: z.enum(["KRX", "US", "OTHER"]), symbolCode: z.string().regex(/^[a-zA-Z0-9.-]{1,20}$/, "종목코드를 확인해 주세요."),
  symbolName: z.string().min(1, "종목명을 입력해 주세요.").max(100), side: z.enum(["buy", "sell"]), quantity: positive, price: positive,
  currency: z.enum(["KRW", "USD"]), fee: nonnegative, tax: nonnegative, broker: z.enum(["", "kiwoom", "toss", "other"]), accountLabel: z.string().max(30),
});
type Values = z.infer<typeof schema>;
export function TradeDialog({ trade, onClose }: { trade?: Trade; onClose: () => void }) {
  const mutations = useJournalMutations();
  const [saved, setSaved] = useState<Trade | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: trade ? { ...trade, tradedTime: trade.tradedTime ?? "", broker: trade.broker ?? "", accountLabel: trade.accountLabel ?? "" } : { tradedOn: todayKst(), tradedTime: "", market: "KRX", currency: "KRW", symbolCode: "", symbolName: "", side: "buy", quantity: "", price: "", fee: "0", tax: "0", broker: "", accountLabel: "" } });
  const market = useWatch({ control: form.control, name: "market" });
  async function submit(values: Values) {
    setError(null);
    try {
      const data: TradeInput = { ...values, tradedTime: values.tradedTime || null, broker: values.broker || null, accountLabel: values.accountLabel || null };
      setSaved(await mutations.saveTrade.mutateAsync({ id: trade?.id, data }));
      toast.success("매매 기록을 저장했어요.");
    } catch (error) {
      const result = toSubmitErrors(error, Object.keys(schema.shape) as (keyof Values)[]);
      applyFieldErrors(form.setError, result.fieldErrors); setError(result.formError);
    }
  }
  const input = (name: keyof Values, label: string, type = "text") => <Field label={label} error={form.formState.errors[name]?.message}><Input type={type} step={type === "number" ? "any" : undefined} {...form.register(name)} /></Field>;
  return <Dialog open onOpenChange={open => { if (!open && !form.formState.isSubmitting) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogTitle>{trade ? "매매 수정" : "매매 추가"}</DialogTitle><DialogDescription>완료된 매매를 기록해 주세요. 날짜만 알면 시각은 비워 두세요.</DialogDescription>
    {saved ? <div className="space-y-4"><p>매매 기록을 저장했어요.</p><Button asChild><Link href={`/journal/${saved.id}`} onClick={onClose}>이 거래에 노트 남기기</Link></Button><Button variant="outline" onClick={onClose}>완료</Button></div> : <form onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        {input("tradedOn", "거래 날짜", "date")}{input("tradedTime", "시각 (선택)", "time")}
        <Field label="시장"><select className={selectClass} {...form.register("market", { onChange: e => form.setValue("currency", e.target.value === "US" ? "USD" : "KRW") })}><option value="KRX">국내 (KRX)</option><option value="US">미국 (US)</option><option value="OTHER">기타</option></select></Field>
        <Field label="통화"><select className={selectClass} {...form.register("currency")} disabled={market !== "OTHER"}><option value="KRW">KRW (원)</option><option value="USD">USD ($)</option></select></Field>
        {input("symbolCode", "종목코드")}{input("symbolName", "종목명")}
        <Field label="매매 구분"><select className={selectClass} {...form.register("side")}><option value="buy">매수</option><option value="sell">매도</option></select></Field>
        {input("quantity", "수량", "number")}{input("price", "단가", "number")}{input("fee", "수수료", "number")}{input("tax", "세금", "number")}
        <Field label="증권사"><select className={selectClass} {...form.register("broker")}><option value="">선택 안 함</option><option value="kiwoom">키움</option><option value="toss">토스</option><option value="other">기타</option></select></Field>
        {input("accountLabel", "계좌 별칭")}
      </div><Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "저장 중…" : "저장"}</Button>
    </form>}</DialogContent></Dialog>;
}
