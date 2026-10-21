"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, get, useForm, useWatch, type Path } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Disclaimer } from "@/components/common/Disclaimer";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import { defaultForm, fromInput, successionSchema, toInput, type SuccessionForm } from "../form";
import { useComparePlans, useDeleteCase, useSaveCase, useSuccessionCase, useWithdrawConsent } from "../hooks";
import type { CaseEnvelope, SuccessionInput, SuccessionResult } from "../types";
import { AssetsSection } from "./AssetsSection";
import { AssumptionsSection } from "./AssumptionsSection";
import { ChildrenSection } from "./ChildrenSection";
import { ConsentBox, type ConsentChecks } from "./ConsentBox";
import { ParentsSection } from "./ParentsSection";
import { ResultView } from "./ResultView";
import { ReviewSummary } from "./ReviewSummary";

interface Computed {
  input: SuccessionInput;
  result: SuccessionResult;
}

export function SuccessionPage() {
  const query = useSuccessionCase();
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <Workspace saved={query.data} />;
}

function Header() {
  return (
    <div className="space-y-4 print:hidden">
      <PageHeader
        title="상속·증여(과제)"
        description="부모님 재산을 누구에게, 무엇을, 언제, 얼마나 넘기면 세금이 가장 적은지 방안별로 비교해 보세요."
        actions={<Badge variant="outline">2026.05.10 시행 세법 기준</Badge>}
      />
      <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
        <Disclaimer variant="tax" />
        <p className="text-sm break-keep">실행 전에는 세무전문가가 입력 정보와 결과를 검토하도록 ‘검토용 요약’을 출력해 주세요.</p>
      </div>
    </div>
  );
}

function Workspace({ saved }: { saved: CaseEnvelope }) {
  const review = useSearchParams().get("view") === "review";
  const form = useForm<SuccessionForm>({
    resolver: zodResolver(successionSchema),
    defaultValues: saved.case ? fromInput(saved.case) : defaultForm(),
  });
  const consented = Boolean(saved.sensitiveConsentAt);
  const [checks, setChecks] = useState<ConsentChecks>({ agree: consented, informed: consented });
  const [computed, setComputed] = useState<Computed | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const compare = useComparePlans();
  const save = useSaveCase();
  const remove = useDeleteCase();
  const withdraw = useWithdrawConsent();
  const values = useWatch({ control: form.control }) as SuccessionForm;
  const consent = checks.agree && checks.informed;
  const dirty = form.formState.isDirty || consent !== consented;
  const stale = computed !== null && JSON.stringify(toInput(values)) !== JSON.stringify(computed.input);

  // 검토용 요약을 바로 열었는데 결과가 없으면 저장한 입력으로 다시 계산한다.
  const autoCompare = review && computed === null && saved.case !== null;
  const { mutate: runCompare, isIdle: compareIdle } = compare;
  useEffect(() => {
    if (autoCompare && compareIdle && saved.case) {
      const input = saved.case;
      runCompare(input, { onSuccess: (result) => setComputed({ input, result }) });
    }
  }, [autoCompare, compareIdle, runCompare, saved.case]);

  function applyServerError(error: unknown) {
    if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
      let unmapped = error.details.length === 0;
      error.details.forEach((detail, index) => {
        if (get(form.getValues(), detail.field) !== undefined) {
          form.setError(detail.field as Path<SuccessionForm>, { type: "server", message: detail.message }, { shouldFocus: index === 0 });
        } else unmapped = true;
      });
      setFormError(unmapped ? error.details[0]?.message ?? error.message : null);
      return;
    }
    setFormError(getErrorMessage(error));
  }

  async function compareValues(formValues: SuccessionForm) {
    setFormError(null);
    const input = toInput(formValues);
    try {
      const result = await compare.mutateAsync(input);
      setComputed({ input, result });
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
    } catch (error) {
      applyServerError(error);
    }
  }

  async function saveValues(formValues: SuccessionForm) {
    setFormError(null);
    try {
      await save.mutateAsync({ input: toInput(formValues), consent });
      form.reset(formValues);
      if (!consent) setChecks({ agree: false, informed: false });
      toast.success(consent ? "입력과 부모님 건강 상태를 저장했어요." : "입력을 저장했어요. 건강 상태는 저장하지 않았어요.");
    } catch (error) {
      applyServerError(error);
    }
  }

  async function onClear() {
    await remove.mutateAsync(undefined);
    form.reset(defaultForm());
    setChecks({ agree: false, informed: false });
    setComputed(null);
    setFormError(null);
    toast.success("저장한 입력을 지웠어요.");
  }

  async function onWithdraw() {
    try {
      await withdraw.mutateAsync(undefined);
      setChecks({ agree: false, informed: false });
      toast.success("동의를 철회하고 저장한 건강 상태를 지웠어요.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  if (review) {
    return (
      <div className="min-w-0 space-y-5">
        {computed ? (
          <ReviewSummary result={computed.result} input={computed.input} />
        ) : autoCompare && !compare.isError ? (
          <LoadingState />
        ) : (
          <div className="space-y-3 rounded-xl border bg-card p-6 text-sm">
            <h1 className="text-xl font-semibold">세무전문가 검토용 요약</h1>
            <p role="alert">{compare.isError ? getErrorMessage(compare.error) : "먼저 방안을 계산해 주세요."}</p>
            <Button asChild variant="outline">
              <Link href="/succession">입력 화면으로</Link>
            </Button>
          </div>
        )}
      </div>
    );
  }

  const busy = compare.isPending || save.isPending || remove.isPending;
  return (
    <div className="min-w-0 space-y-5">
      <Header />
      <FormProvider {...form}>
        <form noValidate onSubmit={(event) => form.handleSubmit(compareValues)(event)} className="min-w-0 space-y-5" aria-label="상속·증여(과제) 입력">
          <ParentsSection />
          <AssetsSection />
          <ChildrenSection />
          <AssumptionsSection />
          <ConsentBox checks={checks} onChange={setChecks} consentAt={saved.sensitiveConsentAt} onWithdraw={onWithdraw} />
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => form.handleSubmit(saveValues)()} disabled={busy}>
              {save.isPending ? "저장 중…" : "저장"}
            </Button>
            <Button type="submit" disabled={busy}>
              {compare.isPending ? "계산 중…" : "방안 비교하기"}
            </Button>
            <ConfirmDialog
              title="입력을 지울까요?"
              description="저장한 입력과 건강 상태 동의 기록을 모두 지워요. 되돌릴 수 없어요."
              confirmLabel="지우기"
              destructive
              onConfirm={onClear}
              trigger={
                <Button type="button" variant="ghost" disabled={busy}>
                  입력 지우기
                </Button>
              }
            />
            {dirty && <span className="text-sm text-muted-foreground">저장하지 않은 변경이 있어요</span>}
          </div>
        </form>
      </FormProvider>
      <div ref={resultsRef} className="min-w-0 scroll-mt-20">
        {stale && (
          <p className="mb-3 rounded-lg border bg-muted/40 p-3 text-sm">입력이 바뀌었어요. ‘방안 비교하기’를 다시 눌러 주세요.</p>
        )}
        {computed && <ResultView result={computed.result} input={computed.input} />}
      </div>
    </div>
  );
}
