"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Disclaimer } from "@/components/common/Disclaimer";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { MoneyText } from "@/components/common/MoneyText";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getErrorMessage } from "@/lib/api-client";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { formatDate, formatKRWCompact } from "@/lib/format";
import { ALLOCATION_PATHS, GOAL_TYPE_LABEL, HORIZON_LABEL, MAX_DEPENDENTS, MAX_GOALS, ONBOARDING_QUERY } from "../constants";
import { useDeleteGoal, useGoals, usePutSituation, useSituation } from "../hooks";
import type { Goal, Situation } from "../types";
import { situationSchema, type SituationFormInput, type SituationFormOutput } from "../validation";
import { AmountInput } from "./AmountInput";
import { GoalDialog, type GoalDialogTarget } from "./GoalDialog";
import { OnboardingProgress, useIsOnboarding } from "./OnboardingProgress";

const SITUATION_FIELDS = ["monthlyExpense", "dependents", "consumerDebt"] as const;
const NEXT_AFTER_ONBOARDING = `${ALLOCATION_PATHS.assets}${ONBOARDING_QUERY}`;

export function emergencyText(situation: Pick<Situation, "emergencyTarget" | "emergencyMonths">): string {
  return `비상금 목표: ${formatKRWCompact(situation.emergencyTarget)}(${situation.emergencyMonths}개월)`;
}

/** 9.4 목표·상황 */
export function SituationManager() {
  const onboarding = useIsOnboarding();
  const situation = useSituation();
  const goals = useGoals();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {onboarding && <OnboardingProgress step={2} />}
      <PageHeader
        title="목표·상황"
        description="생활비와 가까운 목표를 알려 주면 비상금과 목표 자금을 먼저 떼어 두고 권장 배분을 계산해요."
      />
      <GoalSection goals={goals} />
      {situation.isPending ? (
        <LoadingState rows={3} />
      ) : situation.isError ? (
        <ErrorState error={situation.error} onRetry={() => situation.refetch()} />
      ) : (
        <SituationForm situation={situation.data} onboarding={onboarding} />
      )}
      <Disclaimer variant="investment" />
    </div>
  );
}

function GoalSection({ goals }: { goals: ReturnType<typeof useGoals> }) {
  const [dialog, setDialog] = useState<GoalDialogTarget | null>(null);
  const deleteGoal = useDeleteGoal();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const items = goals.data ?? [];
  const full = items.length >= MAX_GOALS;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>목표</h2>
        </CardTitle>
        <CardDescription>
          1년 안에 쓸 돈은 현금성 자산, 1~3년 안이면 채권으로 먼저 떼어 둬요. {full && "목표는 10개까지 만들 수 있어요."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {deleteError && (
          <Alert variant="destructive">
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        )}
        {goals.isPending ? (
          <LoadingState rows={2} />
        ) : goals.isError ? (
          <ErrorState error={goals.error} onRetry={() => goals.refetch()} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 목표가 없어요. 내 집 마련, 결혼 자금처럼 돈을 쓸 날이 정해진 목표를 추가해 보세요.</p>
        ) : (
          <ul aria-label="목표 목록" className="grid gap-3 sm:grid-cols-2">
            {items.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onEdit={() => setDialog({ mode: "edit", goal })}
                onDelete={async () => {
                  setDeleteError(null);
                  try {
                    await deleteGoal.mutateAsync(goal.id);
                  } catch (error) {
                    setDeleteError(getErrorMessage(error));
                  }
                }}
              />
            ))}
          </ul>
        )}
        <Button type="button" variant="outline" disabled={full || goals.isPending} onClick={() => setDialog({ mode: "create" })}>
          <Plus aria-hidden="true" />
          목표 추가
        </Button>
      </CardContent>
      <GoalDialog target={dialog} onClose={() => setDialog(null)} />
    </Card>
  );
}

function GoalCard({ goal, onEdit, onDelete }: { goal: Goal; onEdit: () => void; onDelete: () => Promise<void> }) {
  return (
    <li className="flex min-w-0 items-start justify-between gap-2 rounded-lg border p-3">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {GOAL_TYPE_LABEL[goal.goalType]}
          <Badge variant={goal.horizon === "long_term" ? "outline" : "secondary"}>{HORIZON_LABEL[goal.horizon]}</Badge>
        </p>
        <p className="font-medium break-keep wrap-anywhere">{goal.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <MoneyText value={goal.targetAmount} compact />
          <span className="flex items-center gap-1 text-muted-foreground">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            {formatDate(goal.targetDate)}
          </span>
        </p>
      </div>
      <div className="flex shrink-0">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`${goal.title} 수정`} onClick={onEdit}>
          <Pencil aria-hidden="true" />
        </Button>
        <ConfirmDialog
          title="목표를 삭제할까요?"
          description={<span className="wrap-anywhere">{`'${goal.title}'을(를) 삭제하면 권장 배분이 다시 계산돼요.`}</span>}
          confirmLabel="삭제"
          destructive
          onConfirm={onDelete}
          trigger={
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`${goal.title} 삭제`}>
              <Trash2 aria-hidden="true" />
            </Button>
          }
        />
      </div>
    </li>
  );
}

function SituationForm({ situation, onboarding }: { situation: Situation | null; onboarding: boolean }) {
  const router = useRouter();
  const putSituation = usePutSituation();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SituationFormInput, unknown, SituationFormOutput>({
    resolver: zodResolver(situationSchema),
    defaultValues: {
      monthlyExpense: situation ? String(situation.monthlyExpense) : "",
      dependents: String(situation?.dependents ?? 0),
      consumerDebt: situation ? String(situation.consumerDebt) : "",
    },
  });

  const next = onboarding ? NEXT_AFTER_ONBOARDING : ALLOCATION_PATHS.recommendation;

  async function save(values: SituationFormOutput) {
    setFormError(null);
    try {
      const saved = await putSituation.mutateAsync(values);
      toast.success(`저장했어요. ${emergencyText(saved)}`);
      router.push(next);
    } catch (error) {
      const result = toSubmitErrors(error, SITUATION_FIELDS);
      applyFieldErrors(form.setError, result.fieldErrors);
      setFormError(result.formError);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    // 온보딩에서 생활비를 비워 두면 저장하지 않고 다음 단계로 간다(목표만 입력한 경우).
    if (onboarding && situation === null && form.getValues("monthlyExpense") === "") {
      event.preventDefault();
      router.push(next);
      return;
    }
    await form.handleSubmit(save)(event);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>상황</h2>
        </CardTitle>
        <CardDescription>월 생활비로 비상금 목표를 정해요. 부양가족이 있으면 6개월치로 늘려요.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <FormField
              control={form.control}
              name="monthlyExpense"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>월 생활비</FormLabel>
                  <FormControl>
                    <AmountInput
                      ref={field.ref}
                      name={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      placeholder="0"
                      groupClassName="sm:w-72"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dependents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>부양가족 수</FormLabel>
                  <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full sm:w-40">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Array.from({ length: MAX_DEPENDENTS + 1 }, (_, count) => (
                        <SelectItem key={count} value={String(count)}>
                          {count}명
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>본인 말고 생활비를 책임지는 가족 수예요.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="consumerDebt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>고금리 대출 잔액</FormLabel>
                  <FormControl>
                    <AmountInput
                      ref={field.ref}
                      name={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      placeholder="0"
                      groupClassName="sm:w-72"
                    />
                  </FormControl>
                  <FormDescription>신용대출·카드론·현금서비스 등. 주택담보대출은 넣지 않아요.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {situation && (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm font-medium" aria-live="polite">
                {emergencyText(situation)}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {onboarding && (
                <Button asChild variant="ghost" size="lg">
                  <Link href={NEXT_AFTER_ONBOARDING}>건너뛰기</Link>
                </Button>
              )}
              <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "저장 중…" : onboarding ? "다음" : "저장"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
