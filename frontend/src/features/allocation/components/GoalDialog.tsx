"use client";

import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { cn } from "@/lib/utils";
import { GOAL_TYPE_LABEL } from "../constants";
import { goalDateRange } from "../dates";
import { useCreateGoal, useUpdateGoal } from "../hooks";
import { GOAL_TYPES, type Goal } from "../types";
import { createGoalSchema, type GoalFormInput, type GoalFormOutput } from "../validation";
import { AmountInput } from "./AmountInput";

const FIELDS = ["goalType", "title", "targetAmount", "targetDate"] as const;

export type GoalDialogTarget = { mode: "create" } | { mode: "edit"; goal: Goal };

interface GoalDialogProps {
  target: GoalDialogTarget | null;
  onClose: () => void;
}

/** 목표 추가·수정 다이얼로그(9.4): 종류 칩 7개, 이름, 금액, 목표일 */
export function GoalDialog({ target, onClose }: GoalDialogProps) {
  // 닫히는 애니메이션 동안에도 마지막 내용을 그대로 보여 준다(target이 먼저 null이 된다).
  const [shown, setShown] = useState(target);
  if (target !== null && target !== shown) setShown(target);
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {shown && <GoalForm key={shown.mode === "edit" ? shown.goal.id : "create"} target={shown} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function GoalForm({ target, onDone }: { target: GoalDialogTarget; onDone: () => void }) {
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const [formError, setFormError] = useState<string | null>(null);
  const schema = useMemo(() => createGoalSchema(), []);
  const range = useMemo(() => goalDateRange(), []);
  const goal = target.mode === "edit" ? target.goal : null;
  const form = useForm<GoalFormInput, unknown, GoalFormOutput>({
    resolver: zodResolver(schema),
    defaultValues: {
      goalType: goal?.goalType ?? ("" as GoalFormInput["goalType"]),
      // 종류 이름 그대로면 비워 둔다(종류를 바꾸면 새 종류 이름이 된다).
      title: goal && goal.title !== GOAL_TYPE_LABEL[goal.goalType] ? goal.title : "",
      targetAmount: goal ? String(goal.targetAmount) : "",
      targetDate: goal?.targetDate ?? "",
    },
  });
  const goalType = useWatch({ control: form.control, name: "goalType" });

  async function onSubmit(values: GoalFormOutput) {
    setFormError(null);
    try {
      if (goal) {
        await updateGoal.mutateAsync({ id: goal.id, input: values });
      } else {
        await createGoal.mutateAsync(values);
      }
      onDone();
    } catch (error) {
      const result = toSubmitErrors(error, FIELDS);
      applyFieldErrors(form.setError, result.fieldErrors);
      setFormError(result.formError);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <DialogHeader>
          <DialogTitle>{goal ? "목표 수정" : "목표 추가"}</DialogTitle>
          <DialogDescription>3년 안에 쓸 돈은 권장 배분에서 안전한 자산으로 먼저 떼어 둬요.</DialogDescription>
        </DialogHeader>
        {formError && (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <FormField
          control={form.control}
          name="goalType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>종류</FormLabel>
              <FormControl>
                <RadioGroup
                  ref={field.ref}
                  value={field.value}
                  onValueChange={field.onChange}
                  className="flex flex-wrap gap-2"
                >
                  {GOAL_TYPES.map((type) => {
                    const id = `goal-type-${type}`;
                    return (
                      <Label
                        key={type}
                        htmlFor={id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 font-normal",
                          field.value === type && "border-primary bg-primary/5",
                        )}
                      >
                        <RadioGroupItem id={id} value={type} />
                        {GOAL_TYPE_LABEL[type]}
                      </Label>
                    );
                  })}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>이름</FormLabel>
              <FormControl>
                <Input placeholder={goalType ? GOAL_TYPE_LABEL[goalType] : "선택 입력"} {...field} />
              </FormControl>
              <FormDescription>비워 두면 종류 이름으로 저장해요. 30자까지 쓸 수 있어요.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="targetAmount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>목표 금액</FormLabel>
              <FormControl>
                <AmountInput
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="0"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="targetDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>목표일</FormLabel>
              <FormControl>
                <Input type="date" min={range.min} max={range.max} className="w-full sm:w-48" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            취소
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "저장 중…" : "저장"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
