"use client";

import Link from "next/link";
import { ChartPie, ChevronRight } from "lucide-react";
import { DonutChart } from "@/components/charts/DonutChart";
import { assetColor } from "@/components/charts/palette";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ASSET_CLASS_LABEL } from "@/lib/domain";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AllocationSection } from "../types";
import { ALLOCATION_NEXT_STEP, TONE_CLASS, formatScoreDelta, toneOf } from "../utils";
import { SectionCard } from "./SectionCard";

interface AllocationCardProps {
  data: AllocationSection | null;
  onRetry: () => void;
  retrying: boolean;
}

/** 배분 점수·등급·변화, 실제 비중 도넛, 먼저 할 일 한 줄 */
export function AllocationCard({ data, onRetry, retrying }: AllocationCardProps) {
  return (
    <SectionCard
      title="자산배분"
      icon={ChartPie}
      link={{ href: "/allocation", label: "자세히" }}
      failed={data === null}
      onRetry={onRetry}
      retrying={retrying}
    >
      {data && <AllocationBody data={data} />}
    </SectionCard>
  );
}

function AllocationBody({ data }: { data: AllocationSection }) {
  const ready = data.status === "ready" && data.score !== null;
  const next = data.status === "ready" ? null : ALLOCATION_NEXT_STEP[data.status];
  return (
    <>
      {ready ? (
        <>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <p className="text-3xl font-semibold tabular-nums">
              {data.score}
              <span className="ml-0.5 text-base font-normal text-muted-foreground">점</span>
            </p>
            {data.grade && <Badge variant="secondary">{data.grade}등급</Badge>}
            {data.scoreDelta !== null && (
              <span className={cn("text-sm tabular-nums", TONE_CLASS[toneOf(data.scoreDelta)])}>
                {formatScoreDelta(data.scoreDelta)}
                <span className="sr-only"> (지난 점수 대비)</span>
              </span>
            )}
          </div>
          {data.classes && (
            <div className="mx-auto w-full max-w-56">
              <DonutChart
                ariaLabel="실제 자산 비중"
                centerLabel={<span className="text-xs text-muted-foreground">실제 비중</span>}
                valueFormatter={(value) => formatPercent(value, 1)}
                data={data.classes.map((item) => ({
                  key: item.assetClass,
                  label: ASSET_CLASS_LABEL[item.assetClass],
                  value: item.actualWeight,
                  color: assetColor(item.assetClass),
                }))}
              />
            </div>
          )}
        </>
      ) : (
        next && <p className="text-sm text-muted-foreground break-keep">{next.hint}</p>
      )}
      {data.topDirection && (
        <div className="rounded-lg bg-muted/60 p-3">
          <p className="text-xs font-medium text-muted-foreground">먼저 할 일</p>
          <Link
            href={data.topDirection.href}
            className="mt-0.5 flex items-start gap-1 rounded-sm text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="min-w-0 flex-1 break-keep">{data.topDirection.title}</span>
            <ChevronRight className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          </Link>
        </div>
      )}
      {next && (
        <Button asChild size="sm" className="self-start">
          <Link href={next.href}>{next.label}</Link>
        </Button>
      )}
    </>
  );
}
