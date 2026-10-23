"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Disclaimer } from "@/components/common/Disclaimer";
import { Button } from "@/components/ui/button";
import { formatKRW } from "@/lib/format";
import type { SuccessionInput, SuccessionResult } from "../types";
import { childNames, DONOR_LABELS, HEALTH_LABELS, KIND_LABELS, REVIEW_CHECKLIST, ROLE_LABELS, todayKst } from "../utils";
import { DataTable, KeyValueTable } from "./DataTable";
import { PlanDetail } from "./PlanDetail";
import { BasisList, ShortfallWarning } from "./ResultView";

const won = formatKRW;
const yes = (value: boolean) => (value ? "예" : "아니요");

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4 sm:p-6 print:rounded-none print:border-0 print:p-0" aria-label={title}>
      <h2 className="text-lg font-semibold break-keep print:break-after-avoid print:text-sm">{title}</h2>
      {children}
    </section>
  );
}

function InputTables({ input, result }: { input: SuccessionInput; result: SuccessionResult }) {
  const applied = Object.fromEntries(result.parents.map((parent) => [parent.role, parent]));
  return (
    <div className="space-y-4">
      <div className="grid min-w-0 gap-3 md:grid-cols-2 print:grid-cols-2">
        {input.parents.map((parent) => {
          const info = applied[parent.role];
          return (
            <div key={parent.role} className="min-w-0 rounded-lg border p-3 break-inside-avoid">
              <p className="mb-1 font-medium">{ROLE_LABELS[parent.role]}</p>
              <KeyValueTable
                caption={`${ROLE_LABELS[parent.role]} 입력`}
                rows={[
                  ["살아 계심", yes(parent.alive)],
                  ["나이", parent.alive && parent.age !== null ? `${parent.age}세` : "-"],
                  ["건강 상태", parent.alive && parent.health ? HEALTH_LABELS[parent.health] : "선택 안 함"],
                  ["기대여명", info ? `통계 ${info.tableLifeExpectancy}년 × 건강 ${info.healthFactor} → ${info.lifeExpectancy}년` : "-"],
                  ["직접 고친 기대여명", parent.lifeExpectancyYears ? `${parent.lifeExpectancyYears}년` : "없음"],
                  ["재산 명의자", yes(parent.role === input.ownerRole)],
                ]}
              />
            </div>
          );
        })}
        <div className="min-w-0 rounded-lg border p-3 break-inside-avoid">
          <p className="mb-1 font-medium">부모님 생활</p>
          <KeyValueTable
            caption="부모님 생활 입력"
            rows={[
              ["월 생활비", won(input.monthlyLivingCost)],
              ["월 수입(연금 등)", won(input.monthlyIncome)],
              ["부모님 세대 주택 수", `${input.parentsHouseCount}채`],
            ]}
          />
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold print:break-after-avoid">부모님 재산</h3>
        <div className="grid min-w-0 gap-3 md:grid-cols-2 print:grid-cols-2">
          {input.assets.map((asset) => (
            <div key={asset.id} className="min-w-0 rounded-lg border p-3 break-inside-avoid">
              <p className="mb-1 font-medium break-keep">
                {asset.label} · {KIND_LABELS[asset.kind]}
              </p>
              <KeyValueTable
                caption={`${asset.label} 입력`}
                rows={[
                  [asset.kind === "cash" ? "금액" : "시가", won(asset.value)],
                  ["대출", won(asset.loan)],
                  ...(asset.kind === "cash"
                    ? []
                    : ([
                        ["소재 시·도", asset.region ?? "-"],
                        ["조정대상지역", yes(asset.regulated)],
                        ["공시가격", asset.officialPrice === null ? `비움(시가의 ${input.assumptions.officialPriceRatio}%)` : won(asset.officialPrice)],
                        ["취득일", asset.acquiredOn ?? "-"],
                        ["취득가액", asset.acquisitionCost === null ? "-" : won(asset.acquisitionCost)],
                      ] as [string, string][])),
                  ...(asset.kind === "house"
                    ? ([
                        ["전용 85㎡ 초과", yes(asset.over85)],
                        ["거주 기간", `${asset.residedYears}년`],
                        ["취득 당시 조정대상지역", yes(asset.regulatedAtAcquisition)],
                        ["부모님이 사시는 집", yes(asset.parentsLiveHere)],
                      ] as [string, string][])
                    : []),
                  ...(asset.kind === "land" ? ([["비사업용 토지", yes(asset.nonBusinessLand)]] as [string, string][]) : []),
                ]}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold print:break-after-avoid">나와 형제자매</h3>
        <div className="grid min-w-0 gap-3 md:grid-cols-2 print:grid-cols-2">
          {input.children.map((child) => (
            <div key={child.id} className="min-w-0 rounded-lg border p-3 break-inside-avoid">
              <p className="mb-1 font-medium break-keep">
                {child.displayName}
                {child.isSelf ? " (본인)" : ""}
              </p>
              <KeyValueTable
                caption={`${child.displayName} 입력`}
                rows={[
                  ["나이", `${child.age}세`],
                  ["세대 주택 수", `${child.houseCount}채`],
                  ...child.pastGifts.map(
                    (gift, index) =>
                      [`과거 증여 ${index + 1}`, `${gift.giftedOn} ${DONOR_LABELS[gift.donorGroup]} ${won(gift.amount)}(낸 세금 ${won(gift.taxPaid)})`] as [string, string],
                  ),
                ]}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 rounded-lg border p-3 break-inside-avoid">
        <p className="mb-1 font-medium">가정값</p>
        <KeyValueTable
          caption="가정값 입력"
          rows={[
            ["재산 연 증가율", `${input.assumptions.annualGrowthRate}%`],
            ["생활비·수입·간병비 연 상승률", `${input.assumptions.costInflationRate}%`],
            ["월 간병비", won(input.assumptions.careMonthlyCost)],
            ["간병 기간", `${input.assumptions.careYears}년`],
            ["공시가격 비율", `${input.assumptions.officialPriceRatio}%`],
            ["한 분만 계실 때 생활비 비율", `${input.assumptions.survivorLivingRatio}%`],
            ["한 분만 계실 때 수입 비율", `${input.assumptions.survivorIncomeRatio}%`],
          ]}
        />
      </div>
    </div>
  );
}

export function ReviewSummary({ result, input }: { result: SuccessionResult; input: SuccessionInput }) {
  const names = childNames(input);
  return (
    <article className="min-w-0 space-y-5 print:space-y-3 print:text-[11px]" aria-label="세무전문가 검토용 요약">
      <header className="space-y-2 break-inside-avoid">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl print:text-lg">세무전문가 검토용 요약</h1>
        <p className="text-sm text-muted-foreground print:text-[11px]">
          작성일 {todayKst()} · 기준일 {result.baseDate} · 규칙 버전 {result.ruleVersion} · 상속 가정 시점 {result.horizonDate}
        </p>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button type="button" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            인쇄·PDF로 저장
          </Button>
          <Button asChild variant="outline">
            <Link href="/succession">
              <ArrowLeft aria-hidden="true" />
              입력 화면으로
            </Link>
          </Button>
        </div>
        <Disclaimer variant="tax" />
      </header>
      <Block title="입력 정보">
        <InputTables input={input} result={result} />
      </Block>
      <Block title="이전 가능액">
        <KeyValueTable
          caption="이전 가능액 요약"
          rows={[
            ["현금 자산", won(result.funding.cashAssets)],
            ["앞으로 필요한 생활·간병비(현재가치)", won(result.funding.reservePresentValue)],
            ["명의자보다 오래 사시는 분께 남길 몫", won(result.funding.survivorNeed)],
            ["지금 넘길 수 있는 금액", won(Math.max(0, result.funding.transferableNow))],
          ]}
        />
        <ShortfallWarning shortfall={result.funding.shortfall} />
      </Block>
      <Block title="방안 비교표(전체 순위)">
        <DataTable
          caption="방안 비교표(전체 순위)"
          breakpoint="xl"
          columns={[
            { label: "순위" },
            { label: "방안" },
            { label: "세금 합계(상속 시점 기준)", numeric: true },
            { label: "세금 합계(낸 금액)", numeric: true },
            { label: "증여세", numeric: true },
            { label: "취득세", numeric: true },
            { label: "양도세", numeric: true },
            { label: "상속세", numeric: true },
            { label: "부모님에게 남는 재산(지금)", numeric: true },
          ]}
          rows={result.plans.map((plan) => ({
            key: plan.key,
            cells: [
              `${plan.rank}위`,
              plan.label,
              won(plan.taxes.totalAtHorizon),
              won(plan.taxes.total),
              won(plan.taxes.giftTax),
              won(plan.taxes.acquisitionTax),
              won(plan.taxes.capitalGainsTax),
              won(plan.taxes.inheritanceTax),
              won(plan.parentsRemainingNow),
            ],
          }))}
        />
        {result.excluded.length > 0 && (
          <ul className="space-y-1 text-sm">
            {result.excluded.map((item) => (
              <li key={item.key} className="break-keep">
                계산하지 않은 방안: {item.label} — {item.reason}
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="방안별 상세">
        <div className="space-y-6">
          {result.plans.map((plan) => (
            <div key={plan.key} className="space-y-2 print:break-before-auto">
              <h3 className="font-semibold break-keep print:break-after-avoid">
                {plan.rank}위 {plan.label}
              </h3>
              <ul className="list-disc space-y-0.5 pl-5 text-sm print:text-[11px]">
                {plan.reasons.map((reason) => (
                  <li key={reason} className="break-keep">
                    {reason}
                  </li>
                ))}
              </ul>
              <PlanDetail plan={plan} names={names} />
            </div>
          ))}
        </div>
      </Block>
      <Block title="적용 세법 기준과 출처, 계산 가정">
        <BasisList result={result} input={input} />
      </Block>
      <Block title="확인 요청 항목">
        <ol className="space-y-2 text-sm">
          {REVIEW_CHECKLIST.map((item, index) => (
            <li key={item} className="flex items-start gap-2 break-inside-avoid">
              <span aria-hidden="true" className="mt-0.5 inline-block size-4 shrink-0 rounded-sm border border-foreground/60" />
              <span className="break-keep">
                {index + 1}. {item}
              </span>
            </li>
          ))}
        </ol>
      </Block>
      <Block title="검토 의견">
        <div className="space-y-0" aria-label="검토 의견 메모 칸">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} data-testid="memo-line" className="h-9 border-b border-foreground/40 print:h-7" />
          ))}
        </div>
      </Block>
      <Disclaimer variant="tax" className="break-inside-avoid" />
    </article>
  );
}
