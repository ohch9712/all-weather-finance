import Link from "next/link";
import { CircleHelp } from "lucide-react";
import type { StockDetail } from "../types";
import { formatCompactWon, formatMultiple, formatPrice, formatRate, formatWon } from "../utils";

interface Metric {
  label: string;
  value: string;
  /** 용어 설명(07 시드 slug) */
  learnSlug?: string;
}

/** ETF는 재무지표 대신 "ETF란?" 링크를 둔다. */
const FINANCIAL_SLUGS = new Set(["per", "pbr", "roe", "eps"]);

function metricsOf(stock: StockDetail): Metric[] {
  const s = stock.snapshot;
  return [
    { label: "PER", value: formatMultiple(s?.per), learnSlug: "per" },
    { label: "PBR", value: formatMultiple(s?.pbr), learnSlug: "pbr" },
    { label: "ROE", value: formatRate(s?.roe), learnSlug: "roe" },
    { label: "EPS", value: formatWon(s?.eps), learnSlug: "eps" },
    { label: "BPS", value: formatWon(s?.bps) },
    { label: "시가총액", value: formatCompactWon(s?.marketCap), learnSlug: "market-cap" },
    { label: "52주 최고", value: formatPrice(s?.high52w, stock.market) },
    { label: "52주 최저", value: formatPrice(s?.low52w, stock.market) },
    { label: "외국인 비율", value: formatRate(s?.foreignRatio) },
    { label: "거래대금", value: formatCompactWon(s?.tradingValue) },
  ];
}

export function StockMetrics({ stock }: { stock: StockDetail }) {
  const isEtf = stock.kind === "etf";
  const metrics = metricsOf(stock);
  return (
    <section aria-labelledby="metrics-heading" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="metrics-heading" className="font-semibold">
          주요 지표
        </h2>
        {stock.snapshot && <span className="text-xs text-muted-foreground">{stock.snapshot.asOf} 기준</span>}
      </div>
      {isEtf && (
        <p className="text-sm text-muted-foreground break-keep">
          ETF는 여러 종목을 묶은 상품이라 PER·PBR 같은 기업 재무지표가 없어요.{" "}
          <Link href="/learn/etf" className="font-medium text-foreground underline underline-offset-4">
            ETF란?
          </Link>
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map((metric) => {
          const showHelp = metric.learnSlug && !(isEtf && FINANCIAL_SLUGS.has(metric.learnSlug));
          return (
            <div key={metric.label} className="min-w-0 space-y-0.5">
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                {metric.label}
                {showHelp && (
                  <Link
                    href={`/learn/${metric.learnSlug}`}
                    aria-label={`${metric.label} 용어 설명`}
                    className="inline-flex rounded-full text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <CircleHelp className="size-3.5" aria-hidden="true" />
                  </Link>
                )}
              </dt>
              <dd className="truncate font-medium tabular-nums">{metric.value}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
