import { MoneyText } from "@/components/common/MoneyText";
import { seriesColor } from "@/components/charts/palette";
import { formatPercent } from "@/lib/format";
import type { Recommendation } from "../types";

type Layers = NonNullable<Recommendation["layers"]>;

export interface LayerItem {
  key: "emergency" | "shortTerm" | "longTerm";
  label: string;
  amount: number;
  color: string;
}

/** 층 금액(비상금 / 가까운 목표 / 장기 투자). `layering: "applied"`일 때만 쓴다. */
export function layerItems(layers: Layers): LayerItem[] {
  const shortTerm = layers.shortTermGoals.reduce((sum, goal) => sum + (goal.allocatedAmount ?? 0), 0);
  return [
    { key: "emergency", label: "비상금", amount: layers.emergency?.allocatedAmount ?? 0, color: seriesColor(0) },
    { key: "shortTerm", label: "가까운 목표", amount: shortTerm, color: seriesColor(1) },
    { key: "longTerm", label: "장기 투자", amount: layers.longTermAmount ?? 0, color: seriesColor(2) },
  ];
}

/** 층 요약 가로 막대. 한 줄 누적 막대와 층별 금액 목록 */
export function LayerSummary({ layers }: { layers: Layers }) {
  const items = layerItems(layers);
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  return (
    <section aria-labelledby="layer-summary-title" className="min-w-0 space-y-3">
      <h3 id="layer-summary-title" className="text-sm font-medium">
        층별 금액
      </h3>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {total > 0 &&
          items
            .filter((item) => item.amount > 0)
            .map((item) => (
              <span
                key={item.key}
                className="h-full"
                style={{ width: `${(item.amount / total) * 100}%`, background: item.color }}
              />
            ))}
      </div>
      <ul className="space-y-1.5 text-sm">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block size-2.5 rounded-[3px]" style={{ background: item.color }} />
              {item.label}
            </span>
            <span className="flex items-baseline gap-2">
              <MoneyText value={item.amount} compact className="font-medium" />
              <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                {formatPercent(total > 0 ? (item.amount / total) * 100 : 0, 1)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
