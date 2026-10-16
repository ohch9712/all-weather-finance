"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ASSET_CLASSES, ASSET_CLASS_LABEL } from "@/lib/domain";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import type { HoldingPreset } from "../constants";
import { useCreateHolding, useUpdateHolding } from "../hooks";
import type { Holding } from "../types";
import { holdingSchema, type HoldingFormInput, type HoldingFormOutput } from "../validation";
import { AmountInput } from "./AmountInput";

const FIELDS = ["name", "assetClass", "amount", "includeInAllocation", "memo"] as const;

export type HoldingDialogTarget = { mode: "create"; preset?: HoldingPreset } | { mode: "edit"; holding: Holding };

function defaults(target: HoldingDialogTarget): HoldingFormInput {
  if (target.mode === "edit") {
    const { holding } = target;
    return {
      name: holding.name,
      assetClass: holding.assetClass,
      amount: String(holding.amount),
      includeInAllocation: holding.includeInAllocation,
      memo: holding.memo ?? "",
    };
  }
  return {
    name: target.preset?.name ?? "",
    assetClass: target.preset?.assetClass ?? ("" as HoldingFormInput["assetClass"]),
    amount: "",
    includeInAllocation: target.preset?.includeInAllocation ?? true,
    memo: "",
  };
}

interface HoldingDialogProps {
  /** null이면 닫힘 */
  target: HoldingDialogTarget | null;
  onClose: () => void;
}

/** 보유 자산 추가·수정 다이얼로그(9.3) */
export function HoldingDialog({ target, onClose }: HoldingDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {target && <HoldingForm key={target.mode === "edit" ? target.holding.id : "create"} target={target} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function HoldingForm({ target, onDone }: { target: HoldingDialogTarget; onDone: () => void }) {
  const createHolding = useCreateHolding();
  const updateHolding = useUpdateHolding();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<HoldingFormInput, unknown, HoldingFormOutput>({
    resolver: zodResolver(holdingSchema),
    defaultValues: defaults(target),
  });
  const editing = target.mode === "edit";

  useEffect(() => {
    // 빠른 추가는 이름·자산군이 채워져 있으니 금액부터 입력하게 한다.
    if (target.mode === "create" && target.preset) form.setFocus("amount");
  }, [form, target]);

  async function onSubmit(values: HoldingFormOutput) {
    setFormError(null);
    try {
      if (target.mode === "edit") {
        await updateHolding.mutateAsync({ id: target.holding.id, input: values });
      } else {
        await createHolding.mutateAsync(values);
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
          <DialogTitle>{editing ? "자산 수정" : "자산 추가"}</DialogTitle>
          <DialogDescription>지금 평가금액(원)을 입력해 주세요.</DialogDescription>
        </DialogHeader>
        {formError && (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>이름</FormLabel>
              <FormControl>
                <Input placeholder="예: 비상금 통장" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="assetClass"
          render={({ field }) => (
            <FormItem>
              <FormLabel>자산군</FormLabel>
              <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                    <SelectValue placeholder="자산군 선택" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {ASSET_CLASSES.map((assetClass) => (
                    <SelectItem key={assetClass} value={assetClass}>
                      {ASSET_CLASS_LABEL[assetClass]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>금액</FormLabel>
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
          name="includeInAllocation"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <div className="space-y-0.5">
                <FormLabel>점수 계산에 포함</FormLabel>
                <FormDescription>실거주 주택처럼 배분에서 뺄 자산은 끄세요.</FormDescription>
              </div>
              <FormControl>
                <Switch ref={field.ref} checked={field.value} onCheckedChange={field.onChange} onBlur={field.onBlur} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="memo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>메모</FormLabel>
              <FormControl>
                <Textarea rows={2} placeholder="선택 입력" {...field} />
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
