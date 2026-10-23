"use client";

import Link from "next/link";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { BarChart } from "@/components/charts/BarChart";
import { seriesColor } from "@/components/charts/palette";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatKRW, formatKRWCompact } from "@/lib/format";
import type { Plan, SuccessionInput, SuccessionResult } from "../types";
import {
  childNames,
  ROLE_LABELS,
  scheduleText,
  SHORT_PLAN_LABELS,
  summarizeRecipients,
  summarizeSchedule,
  TIER_LABELS,
} from "../utils";
import { DataTable, KeyValueTable } from "./DataTable";
import { PlanDetail } from "./PlanDetail";

const won = formatKRW;

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6 ${className ?? ""}`} aria-label={title}>
      <h2 className="text-lg font-semibold break-keep">{title}</h2>
      {children}
    </section>
  );
}

export function ShortfallWarning({ shortfall }: { shortfall: number }) {
  if (shortfall <= 0) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive break-keep">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      생활·간병비가 현금보다 {won(shortfall)} 많아요. 지금 재산을 넘기기보다 부모님 생활 자금을 먼저 확보해야 해요.
    </p>
  );
}

export function FundingCard({ result, input }: { result: SuccessionResult; input: SuccessionInput }) {
  const funding = result.funding;
  // 남는 수입이 간병비까지 모두 메우면 해마다 필요 금액이 0이다(20절).
  const noCostNeeded = funding.costs.every((row) => row.total === 0);
  return (
    <Card title="이전 가능액">
      <ul className="grid min-w-0 gap-3 md:grid-cols-2">
        {result.parents.map((parent) => (
          <li key={parent.role} className="min-w-0 rounded-lg bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              {ROLE_LABELS[parent.role]} {parent.age}세{parent.isOwner ? " · 재산 명의자" : ""}
            </p>
            <p className="tabular-nums">
              통계 {parent.tableLifeExpectancy}년 × 건강 {parent.healthFactor} → 적용 {parent.lifeExpectancy}년(가정 {parent.yearsAssumed}년)
            </p>
            <p className="text-muted-foreground">
              예상 시점 {parent.expectedUntil}
              {parent.careFrom ? ` · 간병 가정 ${parent.careFrom}부터` : ""}
            </p>
          </li>
        ))}
      </ul>
      <KeyValueTable
        caption="이전 가능액 계산"
        rows={[
          ["상속 가정 시점", `${result.horizonDate}${result.spouseAliveAtHorizon ? " (배우자 생존)" : ""}`],
          ["현금 자산", won(funding.cashAssets)],
          ["앞으로 필요한 생활·간병비(현재가치)", won(funding.reservePresentValue)],
          ["명의자보다 오래 사시는 분께 남길 몫", won(funding.survivorNeed)],
          ["지금 넘길 수 있는 금액", won(Math.max(0, funding.transferableNow))],
        ]}
      />
      <ShortfallWarning shortfall={funding.shortfall} />
      <details className="rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">연도별 생활비·간병비 보기</summary>
        <div className="mt-3 space-y-3">
          {funding.singleFrom && (
            <p className="text-muted-foreground break-keep">
              {funding.singleFrom}부터는 한 분만 계신다고 보고 생활비 {input.assumptions.survivorLivingRatio}%·수입 {input.assumptions.survivorIncomeRatio}%로 계산했어요.
            </p>
          )}
          {noCostNeeded && (
            <p className="text-muted-foreground break-keep">월 수입이 생활비와 간병비보다 많아 따로 떼어 둘 생활·간병비가 없어요.</p>
          )}
          <DataTable
            caption="연도별 생활비·간병비"
            columns={[
              { label: "연차" },
              { label: "날짜" },
              { label: "생활비", numeric: true },
              { label: "수입", numeric: true },
              { label: "간병비", numeric: true },
              { label: "필요 금액", numeric: true },
            ]}
            rows={funding.costs.map((row) => ({
              key: String(row.year),
              cells: [`${row.year}년차`, row.on, won(row.living), won(row.income), won(row.care), won(row.total)],
            }))}
          />
        </div>
      </details>
    </Card>
  );
}

function TaxLines({ plan }: { plan: Plan }) {
  const taxes = plan.taxes;
  return (
    <div className="space-y-0.5 tabular-nums">
      <p className="font-semibold">상속 시점 기준 {won(taxes.totalAtHorizon)}</p>
      <p className="text-xs text-muted-foreground">낸 금액 합계 {won(taxes.total)}</p>
      <p className="text-xs text-muted-foreground">증여세 {won(taxes.giftTax)}</p>
      <p className="text-xs text-muted-foreground">취득세 {won(taxes.acquisitionTax)}</p>
      <p className="text-xs text-muted-foreground">양도세 {won(taxes.capitalGainsTax)}</p>
      <p className="text-xs text-muted-foreground">상속세 {won(taxes.inheritanceTax)}</p>
    </div>
  );
}

function Lines({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="break-keep">
          {item}
        </li>
      ))}
    </ul>
  );
}

const COMPARE_ROWS: { label: string; render: (plan: Plan, names: Record<string, string>) => React.ReactNode }[] = [
  { label: "이전 대상과 자산 종류", render: (plan, names) => <Lines items={summarizeRecipients(plan, names)} /> },
  { label: "이전 금액과 시기", render: (plan) => <Lines items={summarizeSchedule(plan).map(scheduleText)} /> },
  { label: "예상 세금", render: (plan) => <TaxLines plan={plan} /> },
  { label: "부모님에게 남는 재산(지금)", render: (plan) => <span className="tabular-nums">{won(plan.parentsRemainingNow)}</span> },
  {
    label: "추천 이유",
    render: (plan) => (
      <ul className="list-disc space-y-1 pl-4">
        {plan.reasons.map((reason) => (
          <li key={reason} className="break-keep">
            {reason}
          </li>
        ))}
      </ul>
    ),
  },
];

/** 1~3위 비교표: md 이상은 표, 그보다 좁으면 방안별 카드 */
export function ComparisonTable({ plans, names }: { plans: Plan[]; names: Record<string, string> }) {
  const top = plans.slice(0, 3);
  return (
    <div className="min-w-0">
      <div className="hidden md:block print:block">
        <table className="w-full table-fixed text-left text-sm print:text-[10px]" aria-label="방안 비교표">
          <thead>
            <tr className="border-b">
              <th scope="col" className="w-36 p-2 text-muted-foreground print:w-24">
                <span className="sr-only">항목</span>
              </th>
              {top.map((plan, index) => (
                <th key={plan.key} scope="col" className="p-2 align-top">
                  <Badge variant={index === 0 ? "default" : "outline"}>{TIER_LABELS[index]}</Badge>
                  <span className="mt-1 block font-semibold break-keep">{plan.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row) => (
              <tr key={row.label} className="border-b align-top break-inside-avoid">
                <th scope="row" className="p-2 font-medium text-muted-foreground break-keep">
                  {row.label}
                </th>
                {top.map((plan) => (
                  <td key={plan.key} className="min-w-0 p-2 break-words">
                    {row.render(plan, names)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="space-y-3 md:hidden print:hidden" aria-label="방안 비교 카드">
        {top.map((plan, index) => (
          <li key={plan.key} className="min-w-0 space-y-3 rounded-lg border p-4">
            <div className="space-y-1">
              <Badge variant={index === 0 ? "default" : "outline"}>{TIER_LABELS[index]}</Badge>
              <p className="font-semibold break-keep">{plan.label}</p>
            </div>
            <dl className="space-y-3 text-sm">
              {COMPARE_ROWS.map((row) => (
                <div key={row.label} className="min-w-0 space-y-1">
                  <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                  <dd className="min-w-0 break-words">{row.render(plan, names)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TaxChart({ plans }: { plans: Plan[] }) {
  const data = plans.map((plan) => ({
    name: `${plan.rank}위 ${SHORT_PLAN_LABELS[plan.key]}`,
    total: plan.taxes.totalAtHorizon,
    gift: plan.taxes.giftTax,
    acquisition: plan.taxes.acquisitionTax,
    capital: plan.taxes.capitalGainsTax,
    inheritance: plan.taxes.inheritanceTax,
  }));
  return (
    <BarChart
      data={data}
      xKey="name"
      layout="vertical"
      height={Math.max(220, plans.length * 70)}
      ariaLabel="방안별 상속 시점 기준 세금 합계와 항목"
      valueFormatter={formatKRWCompact}
      series={[
        { key: "total", label: "세금 합계(상속 시점 기준)", color: seriesColor(0) },
        { key: "gift", label: "증여세", color: seriesColor(1) },
        { key: "acquisition", label: "취득세", color: seriesColor(2) },
        { key: "capital", label: "양도세", color: seriesColor(3) },
        { key: "inheritance", label: "상속세", color: seriesColor(4) },
      ]}
    />
  );
}

function PlanDetails({ plan, names }: { plan: Plan; names: Record<string, string> }) {
  return (
    <details className="group rounded-lg border p-3" data-plan={plan.key}>
      <summary className="cursor-pointer text-sm font-medium break-keep">
        {plan.rank}위 {plan.label} 상세 · 상속 시점 기준 세금 {won(plan.taxes.totalAtHorizon)}
      </summary>
      <div className="mt-4">
        <PlanDetail plan={plan} names={names} />
      </div>
    </details>
  );
}

export function BasisList({ result, input }: { result: SuccessionResult; input: SuccessionInput }) {
  const assumptions = input.assumptions;
  return (
    <div className="space-y-3 text-sm">
      <p>
        규칙 버전 <strong>{result.ruleVersion}</strong>(2026.05.10 시행 세법 기준), 기준일 {result.baseDate}
      </p>
      <div>
        <p className="font-medium">출처</p>
        <ul className="list-disc space-y-1 pl-5">
          {result.sources.map((source) => (
            <li key={source.url} className="break-all">
              <a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {source.label}
              </a>
              <span className="hidden print:inline"> ({source.url})</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-medium">가정값</p>
        <p className="text-muted-foreground break-keep">
          재산 연 {assumptions.annualGrowthRate}% · 생활비·간병비 연 {assumptions.costInflationRate}% · 월 간병비 {won(assumptions.careMonthlyCost)} · 간병 {assumptions.careYears}년 · 공시가격 비율 {assumptions.officialPriceRatio}% · 한 분만 계실 때 생활비 {assumptions.survivorLivingRatio}% · 수입 {assumptions.survivorIncomeRatio}%
        </p>
      </div>
      <div>
        <p className="font-medium">안내</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {result.notes.map((note) => (
            <li key={note} className="break-keep">
              {note}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-medium">계산 가정</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {result.assumptions.map((item) => (
            <li key={item} className="break-keep">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ResultView({ result, input }: { result: SuccessionResult; input: SuccessionInput }) {
  const names = childNames(input);
  const top = result.plans.slice(0, 3);
  const others = result.plans.slice(3);
  return (
    <div className="min-w-0 space-y-5" aria-live="polite">
      <FundingCard result={result} input={input} />
      <Card title="방안 비교(상속 시점 기준 세금이 적은 순)">
        <p className="text-sm text-muted-foreground break-keep">
          생활·간병비를 먼저 떼어 둔 뒤, 지금 내는 세금을 상속 시점({result.horizonDate})까지 연 {input.assumptions.annualGrowthRate}%로 불려 상속세와 더한 금액이 가장 적은 방안을 최선안으로 골랐어요.
        </p>
        <ComparisonTable plans={result.plans} names={names} />
        <TaxChart plans={result.plans} />
        <div className="space-y-2">
          <h3 className="font-semibold">방안 상세</h3>
          {top.map((plan) => (
            <PlanDetails key={plan.key} plan={plan} names={names} />
          ))}
        </div>
        {others.length > 0 && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">다른 방안 {others.length}개</summary>
            <div className="mt-3 space-y-2">
              {others.map((plan) => (
                <PlanDetails key={plan.key} plan={plan} names={names} />
              ))}
            </div>
          </details>
        )}
        {result.excluded.length > 0 && (
          <details className="rounded-lg border p-3" open>
            <summary className="cursor-pointer text-sm font-medium">계산하지 않은 방안 {result.excluded.length}개</summary>
            <ul className="mt-3 space-y-2 text-sm">
              {result.excluded.map((item) => (
                <li key={item.key} className="break-keep">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-muted-foreground"> — {item.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      <details className="rounded-xl border bg-card p-4 sm:p-6">
        <summary className="cursor-pointer font-semibold">계산 기준과 가정</summary>
        <div className="mt-4">
          <BasisList result={result} input={input} />
        </div>
      </details>
      <Button asChild>
        <Link href="/succession?view=review">
          <ClipboardList aria-hidden="true" />
          세무전문가 검토용 요약
        </Link>
      </Button>
    </div>
  );
}
