"use client";

import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { LineChart } from "@/components/charts/LineChart";
import { assetColor, seriesColor } from "@/components/charts/palette";
import { Disclaimer } from "@/components/common/Disclaimer";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { MoneyText } from "@/components/common/MoneyText";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ASSET_CLASSES, ASSET_CLASS_LABEL } from "@/lib/domain";
import { formatKRWCompact, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ALLOCATION_PATHS, GRADE_MESSAGE } from "../constants";
import { useRecommendation, useReport, useScores } from "../hooks";
import type { AllocationReport, ByAssetClass, ReportClass } from "../types";
import { AllocationDonut } from "./AllocationDonut";
import { AllocationSampleDisclaimer } from "./AllocationSampleDisclaimer";
import { StatusNotice } from "./StatusNotice";
import { TargetTableDialog } from "./TargetTableDialog";

/** 리밸런싱 표의 차이 문구: "+780만원 더 모으기" / "-120만원 줄이기" */
export function diffLabel(diffAmount: number): string {
  if (diffAmount > 0) return `+${formatKRWCompact(diffAmount)} 더 모으기`;
  if (diffAmount < 0) return `${formatKRWCompact(diffAmount)} 줄이기`;
  return "맞아요";
}

/** 9.2 자산배분 리포트 */
export function AllocationReportView() {
  const report = useReport();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="자산배분"
        description="내 자산이 목표 반영 권장 배분과 얼마나 맞는지 점수로 보여 드려요."
        actions={
          <Button asChild variant="outline">
            <Link href={ALLOCATION_PATHS.assets}>보유 자산 관리</Link>
          </Button>
        }
      />
      {report.isPending ? (
        <LoadingState rows={5} />
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={() => report.refetch()} />
      ) : report.data.status === "needs_profile" || report.data.status === "needs_assessment" ? (
        <StatusNotice status={report.data.status} />
      ) : report.data.status === "needs_holdings" ? (
        <NeedsHoldings report={report.data} />
      ) : (
        <ReadyReport report={report.data} />
      )}
      <AllocationSampleDisclaimer />
      <Disclaimer variant="investment" />
    </div>
  );
}

function ExcludedNote({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Info className="size-4 shrink-0" aria-hidden="true" />
      점수 계산에서 뺀 자산 {formatKRWCompact(amount)}
    </p>
  );
}

function NeedsHoldings({ report }: { report: AllocationReport }) {
  const recommendation = useRecommendation();
  const weights = recommendation.data?.targetWeights;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>내 권장 배분</h2>
        </CardTitle>
        <CardDescription>보유 자산을 입력하면 배분 점수와 조정할 금액을 알려 드려요.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {weights ? (
          <div className="mx-auto max-w-xs">
            <AllocationDonut values={weights} unit="percent" ariaLabel="내 권장 배분" />
          </div>
        ) : recommendation.isError ? (
          <ErrorState error={recommendation.error} onRetry={() => recommendation.refetch()} />
        ) : (
          <LoadingState rows={2} />
        )}
        <ExcludedNote amount={report.excludedAmount} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild size="lg">
            <Link href={ALLOCATION_PATHS.assets}>보유 자산 입력하기</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={ALLOCATION_PATHS.recommendation}>추천 결과 보기</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreCard({ report }: { report: AllocationReport }) {
  const { score, grade, scoreDelta } = report;
  if (score === null || grade === null) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-sm text-muted-foreground">배분 점수</h2>
          <p className="flex items-baseline gap-2">
            <span className="text-5xl font-bold tracking-tight tabular-nums">{score}</span>
            <span className="text-lg text-muted-foreground">점</span>
            <Badge className="ml-1 self-center">{grade}등급</Badge>
          </p>
          {scoreDelta !== null && scoreDelta !== 0 && (
            <p
              className={cn("text-sm font-medium tabular-nums", scoreDelta > 0 ? "text-money-up" : "text-money-down")}
              aria-label={`지난번보다 ${Math.abs(scoreDelta)}점 ${scoreDelta > 0 ? "올랐어요" : "내렸어요"}`}
            >
              {scoreDelta > 0 ? `▲${scoreDelta}` : `▼${Math.abs(scoreDelta)}`}
            </p>
          )}
          {scoreDelta === 0 && <p className="text-sm text-muted-foreground">지난번과 같아요</p>}
        </div>
        <p className="text-base font-medium break-keep sm:max-w-xs sm:text-right">{GRADE_MESSAGE[grade]}</p>
      </CardContent>
    </Card>
  );
}

function amounts(classes: ReportClass[], key: "actualAmount" | "targetAmount"): ByAssetClass<number> {
  return Object.fromEntries(classes.map((item) => [item.assetClass, item[key]])) as ByAssetClass<number>;
}

/** 자산군별 차이 막대(실제 − 권장, %p). 0을 가운데 두고 왼쪽은 부족, 오른쪽은 초과 */
function DiffBars({ classes }: { classes: ReportClass[] }) {
  const diffs = classes.map((item) => ({ ...item, diff: item.actualWeight - item.targetWeight }));
  const maxAbs = Math.max(1, ...diffs.map((item) => Math.abs(item.diff)));
  return (
    <figure className="space-y-2">
      <figcaption className="flex justify-between text-xs text-muted-foreground">
        <span>← 권장보다 적어요</span>
        <span>권장보다 많아요 →</span>
      </figcaption>
      <ul aria-label="자산군별 비중 차이(실제 − 권장)" className="space-y-2">
        {diffs.map((item) => {
          const width = (Math.abs(item.diff) / maxAbs) * 50;
          return (
            <li key={item.assetClass} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2 text-sm">
              <span className="truncate">{ASSET_CLASS_LABEL[item.assetClass]}</span>
              <span className="relative h-3 rounded-sm bg-muted" aria-hidden="true">
                <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                <span
                  className="absolute inset-y-0 rounded-sm"
                  style={{
                    background: assetColor(item.assetClass),
                    width: `${width}%`,
                    left: item.diff >= 0 ? "50%" : `${50 - width}%`,
                  }}
                />
              </span>
              <span className="text-right text-xs tabular-nums">
                {item.diff > 0 ? "+" : ""}
                {item.diff.toFixed(1)}%p
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

function RebalanceTable({ classes }: { classes: ReportClass[] }) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">리밸런싱 표</caption>
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          <th scope="col" className="w-[24%] py-2 text-left font-medium">
            자산군
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            현재 금액
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            목표 금액
          </th>
          <th scope="col" className="w-[34%] py-2 text-right font-medium">
            차이
          </th>
        </tr>
      </thead>
      <tbody>
        {classes.map((item) => (
          <tr key={item.assetClass} className="border-b last:border-0">
            <th scope="row" className="py-2 text-left font-normal break-keep">
              {ASSET_CLASS_LABEL[item.assetClass]}
            </th>
            <td className="py-2 text-right">
              <MoneyText value={item.actualAmount} compact />
            </td>
            <td className="py-2 text-right">
              <MoneyText value={item.targetAmount} compact />
            </td>
            <td
              className={cn(
                "py-2 text-right text-xs break-keep sm:text-sm",
                item.diffAmount > 0 && "text-money-up",
                item.diffAmount < 0 && "text-money-down",
              )}
            >
              {diffLabel(item.diffAmount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScoreHistory() {
  const scores = useScores(180);
  const items = scores.data ?? [];
  if (items.length < 2) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>점수 이력</h2>
        </CardTitle>
        <CardDescription>최근 180일 동안 하루 한 번 남긴 점수예요.</CardDescription>
      </CardHeader>
      <CardContent>
        <LineChart
          data={items.map((item) => ({ day: item.scoredOn.slice(5).replace("-", "."), score: item.score }))}
          xKey="day"
          series={[{ key: "score", label: "배분 점수", color: seriesColor(0) }]}
          valueFormatter={(value) => `${value}점`}
          ariaLabel="배분 점수 이력"
          height={200}
        />
      </CardContent>
    </Card>
  );
}

function ReadyReport({ report }: { report: AllocationReport }) {
  const classes = report.classes ?? [];
  return (
    <>
      <ScoreCard report={report} />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>권장 배분과 내 자산</h2>
          </CardTitle>
          <CardDescription>
            배분 대상 자산 {formatKRWCompact(report.totalAmount)} 기준이에요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-center text-sm font-medium">목표 반영 권장</h3>
              <AllocationDonut values={amounts(classes, "targetAmount")} unit="amount" ariaLabel="목표 반영 권장 배분" />
            </div>
            <div className="space-y-2">
              <h3 className="text-center text-sm font-medium">내 자산</h3>
              <AllocationDonut values={amounts(classes, "actualAmount")} unit="amount" ariaLabel="내 자산 배분" />
            </div>
          </div>
          <ExcludedNote amount={report.excludedAmount} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>자산군별 차이</h2>
          </CardTitle>
          <CardDescription>실제 비중에서 권장 비중을 뺀 값(%p)이에요.</CardDescription>
        </CardHeader>
        <CardContent>
          <DiffBars classes={classes} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>리밸런싱 안내</h2>
          </CardTitle>
          <CardDescription>
            차이 금액은 비중 차이를 알려 주는 참고값이에요. 특정 상품의 매매를 권하는 것이 아니에요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RebalanceTable classes={classes} />
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {ASSET_CLASSES.map((assetClass) => {
              const item = classes.find((entry) => entry.assetClass === assetClass);
              if (!item) return null;
              return (
                <li key={assetClass} className="tabular-nums">
                  {ASSET_CLASS_LABEL[assetClass]} {formatPercent(item.actualWeight, 1)} → {formatPercent(item.targetWeight, 1)}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <ScoreHistory />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button asChild size="lg">
          <Link href={ALLOCATION_PATHS.recommendation}>
            추천 결과 보기
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href={ALLOCATION_PATHS.detail}>왜 이렇게 추천했나요?</Link>
        </Button>
        <TargetTableDialog ageBand={report.ageBand} riskProfile={report.riskProfile} />
      </div>
    </>
  );
}
