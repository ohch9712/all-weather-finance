import { Disclaimer } from "@/components/common/Disclaimer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ComparisonCard, GiftTaxCard } from "../types";
import { CardDetailLink } from "./CardParts";

// 세금 카드(스펙 15 5절). 참고용 추정이라 tax 고지를 한 줄 붙인다.

export function GiftTaxCardView({ card }: { card: GiftTaxCard }) {
  return (
    <Card size="sm" data-card-type="gift_tax">
      <CardHeader>
        <CardTitle className="text-sm break-keep">{card.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="space-y-1.5 text-sm">
          {card.steps.map((step, index) => (
            <li key={`${step.label}-${index}`} className="border-b pb-1.5 last:border-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-keep">{step.label}</span>
                <span className="shrink-0 tabular-nums">{step.amount}</span>
              </div>
              {step.note && <p className="text-xs text-muted-foreground break-keep">{step.note}</p>}
            </li>
          ))}
        </ol>
        <p className="flex items-baseline justify-between gap-3 rounded-lg bg-muted px-3 py-2">
          <span className="text-sm font-medium">납부할 세금</span>
          <span className="font-semibold tabular-nums">{card.payableTax}</span>
        </p>
        <Disclaimer variant="tax" />
        <CardDetailLink href={card.href} label="증여세 계산기에서 보기" />
      </CardContent>
    </Card>
  );
}

export function ComparisonCardView({ card }: { card: ComparisonCard }) {
  return (
    <Card size="sm" data-card-type="comparison">
      <CardHeader>
        <CardTitle className="text-sm break-keep">{card.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{card.horizonDate}에 상속한다고 가정했어요.</p>
        <ul className="space-y-2">
          {card.rows.map((row) => (
            <li
              key={row.key}
              data-recommended={row.recommended ? "true" : undefined}
              className={cn(
                "space-y-1.5 rounded-lg p-3 ring-1 ring-foreground/10",
                row.recommended && "ring-2 ring-primary",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 text-sm font-medium break-keep">{row.label}</span>
                {row.recommended && <Badge>같은 가정에서 가장 많이 남는 방향</Badge>}
              </div>
              {/* 270px 카드에서 금액은 한 줄로 두고 라벨이 줄바꿈한다(스펙 15 11절). */}
              <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-0.5 text-sm">
                <dt className="text-muted-foreground break-keep">가족에게 남는 금액</dt>
                <dd className="text-right font-medium tabular-nums">{row.familyReceives}</dd>
                <dt className="text-muted-foreground break-keep">총 세금(상속 시점 기준)</dt>
                <dd className="text-right tabular-nums">{row.totalTaxAtHorizon}</dd>
                <dt className="text-muted-foreground break-keep">총 세금(낸 금액)</dt>
                <dd className="text-right tabular-nums">{row.totalTax}</dd>
              </dl>
            </li>
          ))}
        </ul>
        <Disclaimer variant="tax" />
        <CardDetailLink href={card.href} label="방향 비교 자세히 보기" />
      </CardContent>
    </Card>
  );
}
