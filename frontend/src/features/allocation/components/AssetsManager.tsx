"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { assetColor } from "@/components/charts/palette";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Disclaimer } from "@/components/common/Disclaimer";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { MoneyText } from "@/components/common/MoneyText";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api-client";
import { ASSET_CLASSES, ASSET_CLASS_LABEL } from "@/lib/domain";
import { formatKRWCompact, formatPercent } from "@/lib/format";
import { ALLOCATION_PATHS, MAX_AMOUNT, ONBOARDING_QUERY, QUICK_ADD_PRESETS, SIMPLE_INPUT_ROWS } from "../constants";
import { useBulkCreateHoldings, useDeleteHolding, useHoldings } from "../hooks";
import type { Holding, HoldingInput } from "../types";
import { allocationMessages, parseAmount } from "../validation";
import { AmountInput } from "./AmountInput";
import { HoldingDialog, type HoldingDialogTarget } from "./HoldingDialog";
import { OnboardingProgress, useIsOnboarding } from "./OnboardingProgress";

const NEXT_AFTER_ONBOARDING = `${ALLOCATION_PATHS.recommendation}${ONBOARDING_QUERY}`;

/** 9.3 보유 자산 */
export function AssetsManager() {
  const onboarding = useIsOnboarding();
  const holdings = useHoldings();
  const [dialog, setDialog] = useState<HoldingDialogTarget | null>(null);

  function content() {
    if (holdings.isPending) return <LoadingState rows={4} />;
    if (holdings.isError) return <ErrorState error={holdings.error} onRetry={() => holdings.refetch()} />;
    if (onboarding && holdings.data.length === 0) return <SimpleHoldingsCard />;
    return (
      <>
        <QuickAdd onPick={(preset) => setDialog({ mode: "create", preset })} />
        <HoldingList holdings={holdings.data} onEdit={(holding) => setDialog({ mode: "edit", holding })} />
        {onboarding && (
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href={NEXT_AFTER_ONBOARDING}>
              다음
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </>
    );
  }

  const showAdd = !(onboarding && holdings.data?.length === 0);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {onboarding && <OnboardingProgress step={3} />}
      <PageHeader
        title="보유 자산"
        description="지금 평가금액을 입력하면 권장 배분과 비교해 점수를 알려 드려요."
        actions={
          showAdd && (
            <Button type="button" onClick={() => setDialog({ mode: "create" })}>
              <Plus aria-hidden="true" />
              자산 추가
            </Button>
          )
        }
      />
      {content()}
      <HoldingDialog target={dialog} onClose={() => setDialog(null)} />
      <Disclaimer variant="investment" />
    </div>
  );
}

function QuickAdd({ onPick }: { onPick: (preset: (typeof QUICK_ADD_PRESETS)[number]) => void }) {
  return (
    <section aria-labelledby="quick-add-title" className="space-y-2">
      <h2 id="quick-add-title" className="text-sm font-medium">
        빠른 추가
      </h2>
      <div className="flex flex-wrap gap-2">
        {QUICK_ADD_PRESETS.map((preset) => (
          <Button key={preset.name} type="button" variant="outline" size="sm" onClick={() => onPick(preset)}>
            <Plus aria-hidden="true" />
            {preset.name}
          </Button>
        ))}
      </div>
    </section>
  );
}

function HoldingList({ holdings, onEdit }: { holdings: Holding[]; onEdit: (holding: Holding) => void }) {
  const deleteHolding = useDeleteHolding();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (holdings.length === 0) {
    return <EmptyState title="아직 입력한 자산이 없어요" description="위의 빠른 추가나 자산 추가 버튼으로 시작해 보세요." />;
  }

  const included = holdings.filter((holding) => holding.includeInAllocation);
  const includedTotal = included.reduce((sum, holding) => sum + holding.amount, 0);
  const excludedTotal = holdings.reduce((sum, holding) => sum + (holding.includeInAllocation ? 0 : holding.amount), 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        배분 대상 합계 <MoneyText value={includedTotal} compact className="font-medium text-foreground" />
        {excludedTotal > 0 && <> · 점수 계산에서 뺀 자산 {formatKRWCompact(excludedTotal)}</>}
      </p>
      {deleteError && (
        <Alert variant="destructive">
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      )}
      {ASSET_CLASSES.map((assetClass) => {
        const items = holdings.filter((holding) => holding.assetClass === assetClass);
        if (items.length === 0) return null;
        const groupTotal = items.reduce((sum, holding) => sum + (holding.includeInAllocation ? holding.amount : 0), 0);
        const weight = includedTotal > 0 ? (groupTotal / includedTotal) * 100 : 0;
        return (
          <Card key={assetClass} size="sm">
            <CardHeader>
              <CardTitle>
                <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    aria-hidden="true"
                    className="inline-block size-2.5 rounded-[3px]"
                    style={{ background: assetColor(assetClass) }}
                  />
                  {ASSET_CLASS_LABEL[assetClass]}
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">
                    {formatKRWCompact(groupTotal)} · {formatPercent(weight, 1)}
                  </span>
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {items.map((holding) => (
                  <li key={holding.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-medium break-keep">
                        {holding.name}
                        {!holding.includeInAllocation && <Badge variant="outline">점수 계산 제외</Badge>}
                        {holding.source !== "manual" && <Badge variant="secondary">증권사 연동</Badge>}
                      </p>
                      <MoneyText value={holding.amount} className="text-sm" />
                      {holding.memo && <p className="text-xs text-muted-foreground break-all">{holding.memo}</p>}
                    </div>
                    <div className="flex shrink-0 items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${holding.name} 수정`}
                        onClick={() => onEdit(holding)}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <ConfirmDialog
                        title="자산을 삭제할까요?"
                        description={`'${holding.name}'을(를) 삭제하면 점수와 추천이 다시 계산돼요.`}
                        confirmLabel="삭제"
                        destructive
                        onConfirm={async () => {
                          setDeleteError(null);
                          try {
                            await deleteHolding.mutateAsync(holding.id);
                          } catch (error) {
                            setDeleteError(getErrorMessage(error));
                          }
                        }}
                        trigger={
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`${holding.name} 삭제`}>
                            <Trash2 aria-hidden="true" />
                          </Button>
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

type SimpleValues = Record<`row${number}`, string>;

/** 온보딩 간단 입력: 6줄 금액 → 0보다 큰 줄만 일괄 생성 */
function SimpleHoldingsCard() {
  const router = useRouter();
  const bulkCreate = useBulkCreateHoldings();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SimpleValues>({
    defaultValues: Object.fromEntries(SIMPLE_INPUT_ROWS.map((_, index) => [`row${index}`, ""])),
  });

  async function onSubmit(values: SimpleValues) {
    setFormError(null);
    const items: HoldingInput[] = [];
    let invalid = false;
    SIMPLE_INPUT_ROWS.forEach((row, index) => {
      const amount = parseAmount(values[`row${index}`] ?? "") ?? 0;
      if (amount > MAX_AMOUNT) {
        form.setError(`row${index}`, { type: "max", message: allocationMessages.amountMax });
        invalid = true;
      }
      if (amount > 0) {
        items.push({ name: row.name, assetClass: row.assetClass, amount, includeInAllocation: row.includeInAllocation, memo: null });
      }
    });
    if (invalid) return;
    try {
      if (items.length > 0) await bulkCreate.mutateAsync(items);
      router.push(NEXT_AFTER_ONBOARDING);
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>간단 입력</h2>
        </CardTitle>
        <CardDescription>대략적인 금액만 넣어도 돼요. 0원인 줄은 저장하지 않아요. 나중에 자세히 고칠 수 있어요.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-3">
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          {SIMPLE_INPUT_ROWS.map((row, index) => {
            const name = `row${index}` as const;
            const id = `simple-${name}`;
            const error = form.formState.errors[name]?.message;
            return (
              <div key={row.name} className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:items-start sm:gap-3">
                <Label htmlFor={id} className="pt-2 break-keep">
                  <span
                    aria-hidden="true"
                    className="inline-block size-2.5 rounded-[3px]"
                    style={{ background: assetColor(row.assetClass) }}
                  />
                  {row.name}
                  {!row.includeInAllocation && <span className="text-xs font-normal text-muted-foreground">(점수 계산 제외)</span>}
                </Label>
                <div>
                  <Controller
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <AmountInput
                        id={id}
                        ref={field.ref}
                        name={field.name}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        placeholder="0"
                        aria-invalid={error ? true : undefined}
                      />
                    )}
                  />
                  {error && <p className="text-sm text-destructive">{error}</p>}
                </div>
              </div>
            );
          })}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button asChild variant="ghost" size="lg">
              <Link href={NEXT_AFTER_ONBOARDING}>건너뛰기</Link>
            </Button>
            <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "저장 중…" : "저장하고 추천 보기"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
