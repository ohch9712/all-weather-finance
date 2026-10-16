"use client";

import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** 확인을 누르면 부른다. Promise를 돌려주면 끝날 때까지 버튼을 막고, 성공하면 닫는다. */
  onConfirm: () => void | Promise<void>;
  /** 삭제처럼 되돌릴 수 없는 동작이면 확인 버튼을 빨간색으로 보여 준다. */
  destructive?: boolean;
  cancelLabel?: string;
  /** 다이얼로그를 여는 요소(버튼). 없으면 `open`·`onOpenChange`로 직접 연다. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  cancelLabel = "취소",
  trigger,
  open,
  onOpenChange,
}: ConfirmDialogProps) {
  const [innerOpen, setInnerOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const isOpen = open ?? innerOpen;

  function setOpen(next: boolean) {
    if (open === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  }

  async function handleConfirm(event: React.MouseEvent) {
    // 확인 동작이 끝난 뒤에 닫는다(AlertDialogAction의 기본 닫힘을 막는다).
    event.preventDefault();
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(next) => !pending && setOpen(next)}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
