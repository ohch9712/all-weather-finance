"use client";

import { DonutChart } from "@/components/charts/DonutChart";
import { assetColor } from "@/components/charts/palette";
import { Disclaimer } from "@/components/common/Disclaimer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ASSET_CLASSES, type AssetClass } from "@/lib/domain";
import { formatPercent } from "@/lib/format";
import type { AllocationCard, DirectionsCard } from "../types";
import { CardDetailLink } from "./CardParts";

// 자산배분 카드(스펙 15 5절). 비중은 숫자로 받아 도넛을 그리고, 색은 --asset-* 토큰이다.

const STATUS_MESSAGE: Record<string, string> = {
  needs_profile: "출생연도를 입력하면 배분 점수를 볼 수 있어요.",
  needs_assessment: "투자성향 진단을 하면 배분 점수를 볼 수 있어요.",
  needs_holdings: "보유 자산을 입력하면 배분 점수를 볼 수 있어요.",
};

function isAssetClass(value: string): value is AssetClass {
  return (ASSET_CLASSES as readonly string[]).includes(value);
}

function percentText(value: number | null): string {
  return value === null ? "-" : formatPercent(value, 1);
}

export function AllocationCardView({ card }: { card: AllocationCard }) {
  const ready = card.status === "ready" && card.classes.length > 0;
  return (
    <Card size="sm" data-card-type="allocation">
      <CardHeader>
        <CardTitle className="text-sm">자산배분 점수</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ready ? (
          <>
            <DonutChart
              ariaLabel="자산군별 실제 비중"
              data={card.classes.map((item) => ({
                key: item.assetClass,
                label: item.label,
                value: item.actualWeight ?? 0,
                color: assetColor(isAssetClass(item.assetClass) ? item.assetClass : "other"),
              }))}
              valueFormatter={(value) => formatPercent(value, 1)}
              centerLabel={
                <span className="flex flex-col">
                  <span className="text-lg font-semibold tabular-nums">{card.score ?? "-"}점</span>
                  {card.grade && <span className="text-xs text-muted-foreground">{card.grade}등급</span>}
                </span>
              }
            />
            <table className="w-full text-sm">
              <caption className="sr-only">자산군별 실제 비중과 권장 비중</caption>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-1 text-left font-medium">
                    자산군
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    실제
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    권장
                  </th>
                </tr>
              </thead>
              <tbody>
                {card.classes.map((item) => (
                  <tr key={item.assetClass} className="border-b last:border-0">
                    <th scope="row" className="py-1 text-left font-normal break-keep">
                      {item.label}
                    </th>
                    <td className="py-1 text-right tabular-nums">{percentText(item.actualWeight)}</td>
                    <td className="py-1 text-right tabular-nums">{percentText(item.targetWeight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm text-muted-foreground break-keep">
            {STATUS_MESSAGE[card.status] ?? "아직 배분 점수를 계산할 수 없어요."}
          </p>
        )}
        <CardDetailLink href={card.href} label="자산배분 화면에서 보기" />
      </CardContent>
    </Card>
  );
}

export function DirectionsCardView({ card }: { card: DirectionsCard }) {
  return (
    <Card size="sm" data-card-type="directions">
      <CardHeader>
        <CardTitle className="text-sm">{card.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="space-y-2.5">
          {card.items.map((item, index) => (
            <li key={`${item.title}-${index}`} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground"
              >
                {index + 1}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium break-keep">{item.title}</p>
                <p className="text-sm text-muted-foreground break-keep">{item.body}</p>
                {item.amount && <p className="text-sm font-medium tabular-nums">{item.amount}</p>}
              </div>
            </li>
          ))}
        </ol>
        <Disclaimer variant="investment" />
        <CardDetailLink href={card.href} label="추천 이유 자세히 보기" />
      </CardContent>
    </Card>
  );
}
