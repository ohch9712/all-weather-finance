"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { currentMonth, formatMonthLabel, shiftMonth } from "../utils";

interface MonthNavigatorProps {
  month: string;
  onChange: (month: string) => void;
}

/** ◀ 2026년 10월 ▶ */
export function MonthNavigator({ month, onChange }: MonthNavigatorProps) {
  const thisMonth = currentMonth();
  return (
    <div className="flex items-center justify-between gap-2 sm:justify-start">
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon" aria-label="이전 달" onClick={() => onChange(shiftMonth(month, -1))}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <h2 className="min-w-28 text-center text-lg font-semibold tabular-nums" aria-live="polite">
          {formatMonthLabel(month)}
        </h2>
        <Button type="button" variant="ghost" size="icon" aria-label="다음 달" onClick={() => onChange(shiftMonth(month, 1))}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      {month !== thisMonth && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(thisMonth)}>
          이번 달
        </Button>
      )}
    </div>
  );
}
