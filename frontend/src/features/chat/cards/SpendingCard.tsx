import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SpendingCard } from "../types";
import { CardDetailLink } from "./CardParts";

// 가계부 한 달 요약 카드(스펙 15 5절). 금액·비율은 서버가 형식화한 문자열이다.

const PERCENT = /^\d+(?:\.\d+)?%$/;

export function SpendingCardView({ card }: { card: SpendingCard }) {
  const totals = [
    { label: "수입", value: card.incomeTotal },
    { label: "지출", value: card.expenseTotal },
    { label: "남은 돈", value: card.net },
  ];
  return (
    <Card size="sm" data-card-type="spending">
      <CardHeader>
        <CardTitle className="text-sm">{card.month} 수입·지출</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {totals.map((item) => (
            <div key={item.label} className="contents">
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="min-w-0 text-right font-medium tabular-nums break-words">{item.value}</dd>
            </div>
          ))}
        </dl>
        {card.topCategories.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">지출이 많은 카테고리</p>
            <ul className="space-y-1.5">
              {card.topCategories.map((item) => (
                <li key={item.name} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 break-keep">{item.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {item.amount} <span className="text-xs text-muted-foreground">{item.ratio}</span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div
                      className="h-full rounded-full bg-chart-1"
                      style={{ width: PERCENT.test(item.ratio) ? item.ratio : "0%" }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <CardDetailLink href={card.href} label="가계부에서 보기" />
      </CardContent>
    </Card>
  );
}
