"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getErrorMessage } from "@/lib/api-client";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { useCategories, useCreateCategory, useDeleteCategory, useRenameCategory } from "../hooks";
import { ENTRY_KINDS, type Category, type EntryKind } from "../types";
import { KIND_LABEL } from "../utils";
import { categoryNameSchema } from "../validation";
import { LedgerFormAlert } from "./LedgerFormAlert";

// 내 카테고리를 지우면 내역이 옮겨 가는 기본 카테고리(스펙 03 5.1)
const FALLBACK_NAME: Record<EntryKind, string> = { expense: "기타 지출", income: "기타 수입" };

const addSchema = z.object({ kind: z.enum(ENTRY_KINDS), name: categoryNameSchema });
type AddInput = z.input<typeof addSchema>;
type AddOutput = z.output<typeof addSchema>;

const renameSchema = z.object({ name: categoryNameSchema });
type RenameInput = z.input<typeof renameSchema>;
type RenameOutput = z.output<typeof renameSchema>;

function CategoryAddForm() {
  const createCategory = useCreateCategory();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<AddInput, unknown, AddOutput>({
    resolver: zodResolver(addSchema),
    defaultValues: { kind: "expense", name: "" },
  });

  async function onSubmit(values: AddOutput) {
    setFormError(null);
    try {
      await createCategory.mutateAsync(values);
      toast.success("카테고리를 추가했어요.");
      form.reset({ kind: values.kind, name: "" });
    } catch (error) {
      const result = toSubmitErrors(error, ["kind", "name"] as const, { codeToField: { CONFLICT: "name" } });
      applyFieldErrors(form.setError, result.fieldErrors);
      setFormError(result.formError);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-2" aria-label="카테고리 추가">
        <LedgerFormAlert message={formError} />
        <div className="flex items-start gap-2">
          <FormField
            control={form.control}
            name="kind"
            render={({ field }) => (
              <FormItem className="shrink-0">
                <FormLabel className="sr-only">종류</FormLabel>
                <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ENTRY_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {KIND_LABEL[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="min-w-0 flex-1">
                <FormLabel className="sr-only">새 카테고리 이름</FormLabel>
                <FormControl>
                  <Input autoComplete="off" placeholder="새 카테고리 이름" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="shrink-0" disabled={form.formState.isSubmitting}>
            추가
          </Button>
        </div>
      </form>
    </Form>
  );
}

function CategoryRenameForm({ category, onDone }: { category: Category; onDone: () => void }) {
  const renameCategory = useRenameCategory();
  const form = useForm<RenameInput, unknown, RenameOutput>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name: category.name },
  });

  async function onSubmit(values: RenameOutput) {
    try {
      await renameCategory.mutateAsync({ id: category.id, name: values.name });
      toast.success("카테고리 이름을 바꿨어요.");
      onDone();
    } catch (error) {
      const result = toSubmitErrors(error, ["name"] as const, { codeToField: { CONFLICT: "name" } });
      applyFieldErrors(form.setError, result.fieldErrors);
      if (result.formError) form.setError("name", { type: "server", message: result.formError });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex w-full items-start gap-2">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className="min-w-0 flex-1">
              <FormLabel className="sr-only">{`${category.name}의 새 이름`}</FormLabel>
              <FormControl>
                <Input autoComplete="off" autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="sm" className="h-8" disabled={form.formState.isSubmitting}>
          저장
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onDone}>
          취소
        </Button>
      </form>
    </Form>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false);
  const deleteCategory = useDeleteCategory();

  async function onDelete() {
    try {
      await deleteCategory.mutateAsync(category.id);
      toast.success("카테고리를 삭제했어요.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  if (editing) {
    return (
      <li className="py-2">
        <CategoryRenameForm category={category} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm">{category.name}</span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`${category.name} 이름 바꾸기`} onClick={() => setEditing(true)}>
        <Pencil aria-hidden="true" />
      </Button>
      <ConfirmDialog
        title="카테고리를 삭제할까요?"
        description={`'${category.name}' 카테고리를 삭제합니다. 내역은 기타로 옮겨집니다(${FALLBACK_NAME[category.kind]}).`}
        confirmLabel="삭제"
        destructive
        onConfirm={onDelete}
        trigger={
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`${category.name} 삭제`}>
            <Trash2 aria-hidden="true" />
          </Button>
        }
      />
    </li>
  );
}

function CategoryLists({ categories }: { categories: Category[] }) {
  const mine = categories.filter((category) => !category.isDefault);
  return (
    <div className="space-y-4">
      {ENTRY_KINDS.map((kind) => {
        const items = mine.filter((category) => category.kind === kind);
        return (
          <section key={kind} aria-label={`내 ${KIND_LABEL[kind]} 카테고리`}>
            <h3 className="text-sm font-medium">{KIND_LABEL[kind]}</h3>
            {items.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">아직 추가한 카테고리가 없어요.</p>
            ) : (
              <ul className="divide-y">
                {items.map((category) => (
                  <CategoryRow key={category.id} category={category} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

interface CategoryManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 내 카테고리 추가·이름 변경·삭제. 기본 카테고리는 바꿀 수 없다. */
export function CategoryManagerDialog({ open, onOpenChange }: CategoryManagerDialogProps) {
  const { data: categories, error, isPending, refetch } = useCategories();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>카테고리 관리</DialogTitle>
          <DialogDescription>내 카테고리를 추가하고 이름을 바꾸거나 지울 수 있어요. 기본 카테고리는 바꿀 수 없어요.</DialogDescription>
        </DialogHeader>
        <CategoryAddForm />
        {isPending ? (
          <LoadingState rows={2} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <CategoryLists categories={categories} />
        )}
      </DialogContent>
    </Dialog>
  );
}
