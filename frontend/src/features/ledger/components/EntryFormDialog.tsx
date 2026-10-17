"use client";

import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getErrorMessage } from "@/lib/api-client";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { cn } from "@/lib/utils";
import { useDeleteEntry, useSaveEntry } from "../hooks";
import { ENTRY_KINDS, PAYMENT_METHODS, type Category, type Entry, type EntryKind } from "../types";
import {
  KIND_LABEL,
  MAX_FUTURE_DAYS,
  MIN_OCCURRED_ON,
  PAYMENT_METHOD_LABEL,
  addDays,
  digitsOnly,
  groupAmountInput,
  todayKst,
} from "../utils";
import { createEntrySchema, type EntryFormInput, type EntryFormOutput } from "../validation";
import { LedgerFormAlert } from "./LedgerFormAlert";

const FIELDS = ["kind", "occurredOn", "amount", "categoryId", "merchant", "paymentMethod", "memo"] as const;
// 1조원은 13자리다.
const MAX_AMOUNT_DIGITS = 13;

function defaultPaymentMethod(kind: EntryKind) {
  return kind === "income" ? "transfer" : "card";
}

function toFormValues(entry: Entry | null, today: string): EntryFormInput {
  if (!entry) {
    return {
      kind: "expense",
      occurredOn: today,
      amount: "",
      categoryId: "",
      merchant: "",
      paymentMethod: defaultPaymentMethod("expense"),
      memo: "",
    };
  }
  return {
    kind: entry.kind,
    occurredOn: entry.occurredOn,
    amount: groupAmountInput(String(entry.amount)),
    categoryId: entry.categoryId,
    merchant: entry.merchant ?? "",
    paymentMethod: entry.paymentMethod,
    memo: entry.memo ?? "",
  };
}

interface EntryFormProps {
  entry: Entry | null;
  categories: Category[];
  onDone: () => void;
}

function EntryForm({ entry, categories, onDone }: EntryFormProps) {
  const today = todayKst();
  const schema = useMemo(() => createEntrySchema(today), [today]);
  const saveEntry = useSaveEntry();
  const deleteEntry = useDeleteEntry();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<EntryFormInput, unknown, EntryFormOutput>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(entry, today),
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const kindCategories = categories.filter((category) => category.kind === kind);

  function changeKind(next: EntryKind) {
    if (next === kind) return;
    form.setValue("kind", next, { shouldDirty: true });
    // 고른 카테고리가 새 종류와 맞지 않으면 다시 고르게 한다.
    const category = categories.find((item) => item.id === form.getValues("categoryId"));
    if (category && category.kind !== next) form.setValue("categoryId", "");
    // 새 내역에서 결제수단을 직접 고르지 않았으면 종류에 맞는 기본값으로 바꾼다.
    if (!entry && !form.getFieldState("paymentMethod").isDirty) {
      form.setValue("paymentMethod", defaultPaymentMethod(next));
    }
  }

  async function onSubmit(values: EntryFormOutput) {
    setFormError(null);
    try {
      await saveEntry.mutateAsync({ id: entry?.id, input: values });
      toast.success(entry ? "내역을 수정했어요." : "내역을 추가했어요.");
      onDone();
    } catch (error) {
      const result = toSubmitErrors(error, FIELDS);
      applyFieldErrors(form.setError, result.fieldErrors);
      setFormError(result.formError);
    }
  }

  async function onDelete() {
    if (!entry) return;
    setFormError(null);
    try {
      await deleteEntry.mutateAsync(entry.id);
      toast.success("내역을 삭제했어요.");
      onDone();
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <LedgerFormAlert message={formError} />
        <div role="radiogroup" aria-label="종류" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {ENTRY_KINDS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => changeKind(value)}
              className={cn(
                "h-8 rounded-md text-sm font-medium text-muted-foreground transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                kind === value && "bg-background text-foreground shadow-sm",
                kind === value && value === "income" && "text-money-down",
              )}
            >
              {KIND_LABEL[value]}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="occurredOn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>날짜</FormLabel>
                <FormControl>
                  <Input type="date" min={MIN_OCCURRED_ON} max={addDays(today, MAX_FUTURE_DAYS)} {...field} />
                </FormControl>
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
                <div className="relative">
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="0"
                      className="pr-8 text-right tabular-nums"
                      {...field}
                      onChange={(event) =>
                        field.onChange(groupAmountInput(digitsOnly(event.target.value).slice(0, MAX_AMOUNT_DIGITS)))
                      }
                    />
                  </FormControl>
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                    원
                  </span>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>카테고리</FormLabel>
                <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                      <SelectValue placeholder="카테고리 선택" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="max-h-72">
                    {kindCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
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
            name="paymentMethod"
            render={({ field }) => (
              <FormItem>
                <FormLabel>결제수단</FormLabel>
                <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PAYMENT_METHODS.map((method) => (
                      <SelectItem key={method} value={method}>
                        {PAYMENT_METHOD_LABEL[method]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="merchant"
          render={({ field }) => (
            <FormItem>
              <FormLabel>사용처</FormLabel>
              <FormControl>
                <Input autoComplete="off" placeholder={kind === "income" ? "예: 회사" : "예: 김밥천국"} {...field} />
              </FormControl>
              <FormMessage />
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
                <Input autoComplete="off" placeholder="선택 입력" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter className="gap-2 sm:justify-between">
          {entry ? (
            <ConfirmDialog
              title="내역을 삭제할까요?"
              description="삭제한 내역은 되돌릴 수 없어요."
              confirmLabel="삭제"
              destructive
              onConfirm={onDelete}
              trigger={
                <Button type="button" variant="destructive">
                  삭제
                </Button>
              }
            />
          ) : (
            <span className="hidden sm:block" />
          )}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "저장 중…" : "저장"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

interface EntryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null이면 새 내역 */
  entry: Entry | null;
  categories: Category[];
}

/** 내역 추가·수정. 저장·삭제 후 목록·요약·추이를 다시 불러온다. */
export function EntryFormDialog({ open, onOpenChange, entry, categories }: EntryFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{entry ? "내역 수정" : "내역 추가"}</DialogTitle>
          <DialogDescription>수입·지출을 직접 기록해요.</DialogDescription>
        </DialogHeader>
        <EntryForm key={entry?.id ?? "new"} entry={entry} categories={categories} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
