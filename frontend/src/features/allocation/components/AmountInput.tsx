"use client";

import type { ComponentProps } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { formatKRWCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { parseAmount } from "../validation";

type AmountInputProps = Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  /** 숫자만 남긴 문자열. 비었으면 "" */
  value: string;
  onChange: (value: string) => void;
  groupClassName?: string;
};

/** 원 단위 금액 입력. 숫자만 받고 쉼표로 묶어 보여 주며, 아래에 만·억 단위 읽기를 덧붙인다. */
export function AmountInput({ value, onChange, groupClassName, id, ...props }: AmountInputProps) {
  const amount = parseAmount(value);
  const helperId = id ? `${id}-amount-helper` : undefined;
  const describedBy = [props["aria-describedby"], helperId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1", groupClassName)}>
      <InputGroup>
        <InputGroupInput
          {...props}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={amount === null ? "" : amount.toLocaleString("ko-KR")}
          onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, ""))}
          aria-describedby={describedBy}
          className="text-right tabular-nums"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>원</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <p id={helperId} className="min-h-4 text-right text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {amount !== null && amount >= 10_000 ? `= ${formatKRWCompact(amount)}` : ""}
      </p>
    </div>
  );
}
