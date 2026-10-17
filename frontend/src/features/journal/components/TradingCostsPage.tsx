"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/common/PageHeader";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Disclaimer } from "@/components/common/Disclaimer";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { getErrorMessage } from "@/lib/api-client";
import { useCostSettings, useCostSettingsMutations } from "../hooks";
import type { CostRates, CostSettings } from "../types";
import { Field } from "./Fields";

const rate = z.string().regex(/^\d+(\.\d{1,4})?$/, "소수 넷째 자리까지 입력해 주세요.").refine(value => Number(value) <= 5, "요율은 0~5%로 입력해 주세요.");
const schema = z.object({ krxCommissionRate: rate, krxSellTaxRate: rate, usCommissionRate: rate });
const fields = [
  ["krxCommissionRate", "국내주식 매매수수료", "키움증권 기준 기본값 0.015%"],
  ["krxSellTaxRate", "국내주식 매도 거래세", "키움증권 기준 기본값 0.20%"],
  ["usCommissionRate", "미국주식 매매수수료", "키움증권 기준 기본값 0.25%"],
] as const;

function SettingsForm({ settings }: { settings: CostSettings }) {
  const mutations = useCostSettingsMutations();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CostRates>({ resolver: zodResolver(schema), defaultValues: settings });
  const pending = mutations.save.isPending || mutations.reset.isPending;
  async function save(values: CostRates) {
    setError(null);
    try {
      const saved = await mutations.save.mutateAsync(values);
      form.reset(saved);
      toast.success("매매 수수료·세금 요율을 저장했어요.");
    } catch (error) {
      const errors = toSubmitErrors(error, fields.map(([name]) => name));
      applyFieldErrors(form.setError, errors.fieldErrors);
      setError(errors.formError);
    }
  }
  async function reset() {
    setError(null);
    try {
      form.reset(await mutations.reset.mutateAsync());
      toast.success("기본 요율로 되돌렸어요.");
    } catch (error) {
      setError(getErrorMessage(error));
      throw error;
    }
  }
  return <form onSubmit={form.handleSubmit(save)} noValidate className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
    <p className="text-sm text-muted-foreground">{settings.isDefault ? "키움증권 기준 기본 요율을 사용하고 있어요." : "직접 설정한 요율을 사용하고 있어요."}</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <fieldset disabled={pending} className="grid min-w-0 gap-5">
      {fields.map(([name, label, hint]) => <div key={name} className="min-w-0 space-y-1.5"><Field label={`${label} (%)`} error={form.formState.errors[name]?.message}><Input type="number" min="0" max="5" step="0.0001" inputMode="decimal" aria-describedby={`${name}-hint`} {...form.register(name)} /></Field><p id={`${name}-hint`} className="text-xs text-muted-foreground">{hint}</p></div>)}
    </fieldset>
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? "처리 중…" : "저장"}</Button><ConfirmDialog title="기본 요율로 되돌릴까요?" description="직접 설정한 요율을 지우고 키움증권 기준 기본값을 사용해요. 이미 저장한 거래는 바뀌지 않아요." confirmLabel="되돌리기" trigger={<Button type="button" variant="outline" disabled={pending}>기본값으로 되돌리기</Button>} onConfirm={reset} /></div>
  </form>;
}

export function TradingCostsPage() {
  const query = useCostSettings();
  return <div className="min-w-0 max-w-2xl space-y-5">
    <PageHeader title="매매 수수료·세금" description="수수료·세금을 모를 때 적용할 기본 요율을 설정해요." />
    <div className="space-y-2 rounded-xl bg-muted p-4 text-sm"><p>증권사 이벤트 등으로 실제 요율과 다를 수 있어요. 증권사가 알려 준 실제 수수료·세금이 있으면 그 값이 우선이에요.</p><p>국내 ETF는 팔 때 거래세가 붙지 않아요.</p><p>요율을 바꿔도 이미 저장한 거래는 바뀌지 않아요.</p></div>
    {query.isPending ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <SettingsForm key={`${query.data.isDefault}-${query.data.updatedAt}`} settings={query.data} />}
    <Disclaimer variant="tax" />
  </div>;
}
