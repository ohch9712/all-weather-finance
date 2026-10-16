import { cn } from "@/lib/utils";
import { formatKRW, formatKRWCompact, formatSignedKRW } from "@/lib/format";

interface MoneyTextProps {
  value: number;
  /** 부호를 붙이고 양수는 빨강, 음수는 파랑(국내 관례)으로 보여 준다. */
  signed?: boolean;
  /** 큰 금액을 만·억 단위로 줄인다. */
  compact?: boolean;
  className?: string;
}

function format(value: number, signed: boolean, compact: boolean): string {
  if (!compact) return signed ? formatSignedKRW(value) : formatKRW(value);
  const text = formatKRWCompact(value);
  return signed && Math.round(value) > 0 ? `+${text}` : text;
}

export function MoneyText({ value, signed = false, compact = false, className }: MoneyTextProps) {
  const rounded = Math.round(value);
  return (
    <span
      className={cn(
        "tabular-nums",
        signed && rounded > 0 && "text-money-up",
        signed && rounded < 0 && "text-money-down",
        className,
      )}
      title={compact ? formatKRW(value) : undefined}
    >
      {format(value, signed, compact)}
    </span>
  );
}
