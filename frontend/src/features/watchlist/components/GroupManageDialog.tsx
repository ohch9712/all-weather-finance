"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getErrorMessage } from "@/lib/api-client";
import { useWatchlistMutations } from "../hooks";
import type { WatchlistItem } from "../types";
import { GROUP_NAME_MAX, groupItems } from "../utils";

interface GroupManageDialogProps {
  items: WatchlistItem[];
  onClose: () => void;
  onRenamed?: (from: string, to: string) => void;
}

function validateName(value: string): string | null {
  const name = value.trim();
  if (!name) return "그룹 이름을 입력해 주세요.";
  if (name.length > GROUP_NAME_MAX) return `그룹 이름은 ${GROUP_NAME_MAX}자까지 입력할 수 있어요.`;
  return null;
}

function GroupRenameRow({
  groupName,
  ids,
  onRenamed,
}: {
  groupName: string;
  ids: string[];
  onRenamed?: (from: string, to: string) => void;
}) {
  const { renameGroup } = useWatchlistMutations();
  const [value, setValue] = useState(groupName);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  async function rename() {
    const problem = validateName(value);
    if (problem) {
      setError(problem);
      return;
    }
    const next = value.trim();
    if (next === groupName) return;
    setError(null);
    try {
      await renameGroup.mutateAsync({ ids, groupName: next });
      toast.success(`그룹 이름을 "${next}"(으)로 바꿨어요.`);
      onRenamed?.(groupName, next);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  return (
    <li className="space-y-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {groupName} <span className="font-normal text-muted-foreground">({ids.length}개)</span>
      </label>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void rename();
        }}
      >
        <Input
          id={inputId}
          value={value}
          maxLength={GROUP_NAME_MAX}
          aria-invalid={!!error}
          aria-label={`${groupName} 새 이름`}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={renameGroup.isPending || value.trim() === groupName}>
          {renameGroup.isPending ? "바꾸는 중…" : "이름 바꾸기"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

/** 그룹 이름 변경. 이름을 바꾸면 그 그룹의 항목들을 새 이름으로 옮긴다(있는 그룹 이름이면 합쳐진다). */
export function GroupManageDialog({ items, onClose, onRenamed }: GroupManageDialogProps) {
  const groups = groupItems(items);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>그룹 관리</DialogTitle>
          <DialogDescription>
            그룹 이름을 바꾸면 그 그룹의 종목이 모두 새 이름으로 옮겨집니다. 이미 있는 그룹 이름을 넣으면 두 그룹이
            합쳐집니다.
          </DialogDescription>
        </DialogHeader>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 그룹이 없어요. 종목을 담으면 &quot;기본&quot; 그룹이 생깁니다.</p>
        ) : (
          <ul className="space-y-4">
            {groups.map((group) => (
              <GroupRenameRow
                key={`${group.groupName}-${group.items.length}`}
                groupName={group.groupName}
                ids={group.items.map((item) => item.id)}
                onRenamed={onRenamed}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
