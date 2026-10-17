import Link from "next/link";
import { Disclaimer } from "@/components/common/Disclaimer";
import { SampleDataBadge } from "@/components/common/SampleDataBadge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StockCard, StockListCard } from "../types";
import { CardDetailLink, ChangeRateText } from "./CardParts";

// 종목 카드(스펙 15 5절). source가 mock이면 "샘플 데이터" 배지와 sample 고지를 붙인다.

function stockHref(code: string): string {
  return `/stocks/${encodeURIComponent(code)}`;
}

export function StockCardView({ card }: { card: StockCard }) {
  const sample = card.source === "mock";
  return (
    <Card size="sm" data-card-type="stock">
      <CardHeader>
        <CardTitle className="text-sm break-keep">
          {card.name} <span className="font-normal text-muted-foreground">{card.code}</span>
        </CardTitle>
        {sample && (
          <CardAction>
            <SampleDataBadge />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-lg font-semibold tabular-nums">{card.price ?? "시세 없음"}</span>
          <ChangeRateText value={card.changeRate} className="text-sm" />
        </p>
        {card.metrics.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {card.metrics.map((metric) => (
              <div key={metric.label} className="min-w-0">
                <dt className="text-xs text-muted-foreground break-keep">{metric.label}</dt>
                <dd className="font-medium tabular-nums break-words">{metric.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {sample && <Disclaimer variant="sample" />}
        <CardDetailLink href={card.href} label="종목 상세 보기" />
      </CardContent>
    </Card>
  );
}

export function StockListCardView({ card }: { card: StockListCard }) {
  const sample = card.source === "mock";
  return (
    <Card size="sm" data-card-type="stock_list">
      <CardHeader>
        <CardTitle className="text-sm break-keep">{card.title}</CardTitle>
        {sample && (
          <CardAction>
            <SampleDataBadge />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {card.asOf && <p className="text-xs text-muted-foreground">{card.asOf} 기준</p>}
        <ul className="divide-y">
          {card.items.map((item) => (
            <li key={item.code}>
              <Link
                href={stockHref(item.code)}
                className="flex items-center justify-between gap-3 py-2 hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium break-keep">{item.name}</span>
                  <span className="block text-xs text-muted-foreground break-keep">
                    {[item.code, item.extra].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {(item.price || item.changeRate) && (
                  <span className="shrink-0 text-right text-sm">
                    <span className="block tabular-nums">{item.price ?? "-"}</span>
                    <ChangeRateText value={item.changeRate} className="block text-xs" />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {sample && <Disclaimer variant="sample" />}
        <CardDetailLink href={card.href} label="전체 보기" />
      </CardContent>
    </Card>
  );
}
