"use client";

import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { useWatchlistMutations } from "../hooks";
import type { WatchlistItem, WatchlistPatchInput } from "../types";
import { GROUP_NAME_MAX, MEMO_MAX } from "../utils";

const schema = z.object({
  groupName: z
    .string()
    .trim()
    .min(1, "그룹 이름을 입력해 주세요.")
    .max(GROUP_NAME_MAX, `그룹 이름은 ${GROUP_NAME_MAX}자까지 입력할 수 있어요.`),
  memo: z.string().trim().max(MEMO_MAX, `메모는 ${MEMO_MAX}자까지 입력할 수 있어요.`),
});
type Values = z.infer<typeof schema>;
const FIELDS = ["groupName", "memo"] as const;

interface WatchlistEditDialogProps {
  item: WatchlistItem;
  groups: string[];
  onClose: () => void;
}

/** 관심종목 한 항목의 메모와 그룹을 바꾼다(PATCH). */
export function WatchlistEditDialog({ item, groups, onClose }: WatchlistEditDialogProps) {
  const { update } = useWatchlistMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const groupListId = useId();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { groupName: item.groupName, memo: item.memo ?? "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function submit(values: Values) {
    setFormError(null);
    const data: WatchlistPatchInput = {};
    if (values.groupName !== item.groupName) data.groupName = values.groupName;
    const memo = values.memo || null;
    if (memo !== item.memo) data.memo = memo;
    if (Object.keys(data).length === 0) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync({ id: item.id, data });
      toast.success("관심종목을 수정했어요.");
      onClose();
    } catch (error) {
      const result = toSubmitErrors(error, FIELDS);
      applyFieldErrors(form.setError, result.fieldErrors);
      setFormError(result.formError);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>메모·그룹 편집</DialogTitle>
          <DialogDescription>
            {item.name}({item.code})의 메모와 그룹을 바꿉니다. 다른 그룹으로 옮기면 그 그룹의 맨 뒤에 놓입니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${groupListId}-group`}>그룹</Label>
            <Input
              id={`${groupListId}-group`}
              list={groupListId}
              maxLength={GROUP_NAME_MAX}
              aria-invalid={!!errors.groupName}
              {...form.register("groupName")}
            />
            <datalist id={groupListId}>
              {groups.map((group) => (
                <option key={group} value={group} />
              ))}
            </datalist>
            {errors.groupName && (
              <p role="alert" className="text-sm text-destructive">
                {errors.groupName.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${groupListId}-memo`}>메모</Label>
            <Textarea
              id={`${groupListId}-memo`}
              rows={4}
              maxLength={MEMO_MAX}
              placeholder="예: 실적 발표 확인"
              aria-invalid={!!errors.memo}
              {...form.register("memo")}
            />
            {errors.memo && (
              <p role="alert" className="text-sm text-destructive">
                {errors.memo.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              취소
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "저장 중…" : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
