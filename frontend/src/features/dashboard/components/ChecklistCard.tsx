"use client";

import Link from "next/link";
import { ChevronRight, Circle, CircleCheck, ListChecks } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "../types";
import { checklistProgress } from "../utils";
import { SectionCard } from "./SectionCard";

/** 처음 쓰는 사용자의 할 일. 모두 끝내면 DashboardPage가 카드를 숨긴다. */
export function ChecklistCard({ items }: { items: ChecklistItem[] }) {
  const { done, total, percent } = checklistProgress(items);
  return (
    <SectionCard title="시작하기" icon={ListChecks}>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground break-keep">할 일을 마치면 홈이 더 정확해져요</span>
          <span className="shrink-0 font-medium tabular-nums">
            {done}/{total} 완료
          </span>
        </div>
        <Progress value={percent} aria-label={`시작하기 진행률 ${percent}%`} />
      </div>
      <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {item.done ? (
                <CircleCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className={cn("min-w-0 flex-1 break-keep", item.done && "text-muted-foreground line-through")}>
                {item.label}
              </span>
              <span className="sr-only">{item.done ? "완료" : "미완료"}</span>
              {!item.done && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
