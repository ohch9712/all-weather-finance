import { formatKRW } from "@/lib/format";
import type { Plan } from "../types";
import { ACQUISITION_LABELS, METHOD_LABELS, recipientName, SALE_CASE_LABELS } from "../utils";
import { DataTable, KeyValueTable } from "./DataTable";

const won = formatKRW;

/** 방안 상세(스펙 11.2): 이전 일정, 매각 내역, 상속 요약, 자녀 주택 수 영향, 자녀에게 남는 금액 */
export function PlanDetail({ plan, names }: { plan: Plan; names: Record<string, string> }) {
  const inheritance = plan.inheritance;
  return (
    <div className="min-w-0 space-y-5 text-sm">
      <div className="space-y-2 break-inside-avoid">
        <h4 className="font-semibold">이전 일정</h4>
        <DataTable
          caption={`${plan.label} 이전 일정`}
          breakpoint="xl"
          columns={[
            { label: "날짜" },
            { label: "받는 사람" },
            { label: "자산" },
            { label: "방법" },
            { label: "금액", numeric: true },
            { label: "증여세", numeric: true },
            { label: "취득세", numeric: true },
          ]}
          rows={plan.transfers.map((transfer, index) => ({
            key: `${transfer.on}-${transfer.assetId ?? "cash"}-${transfer.childId ?? "all"}-${index}`,
            cells: [
              transfer.on,
              recipientName(names, transfer.childId),
              transfer.assetLabel,
              METHOD_LABELS[transfer.method] +
                (transfer.acquisitionTaxCode ? ` · ${ACQUISITION_LABELS[transfer.acquisitionTaxCode]}` : ""),
              won(transfer.amount),
              won(transfer.giftTax),
              won(transfer.acquisitionTax),
            ],
          }))}
        />
      </div>
      {plan.sales.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-semibold">매각 내역(부모님이 지금 팔 때 양도소득세)</h4>
          <div className="grid min-w-0 gap-3 md:grid-cols-2 print:grid-cols-2">
            {plan.sales.map((sale) => (
              <div key={sale.assetId} className="min-w-0 rounded-lg border p-3 break-inside-avoid">
                <p className="mb-1 font-medium">
                  {sale.label} · {SALE_CASE_LABELS[sale.case]}
                </p>
                <KeyValueTable
                  caption={`${sale.label} 양도소득세 단계`}
                  rows={[
                    ["양도가액(시가)", won(sale.price)],
                    ["필요경비(취득가액 등)", won(sale.acquisitionCost)],
                    ["보유 연수", `${sale.holdingYears}년`],
                    ["양도차익", won(sale.gain)],
                    ["과세 양도차익", won(sale.taxableGain)],
                    ["장기보유특별공제", won(sale.longTermDeduction)],
                    ["과세표준", won(sale.taxBase)],
                    ["산출세액", won(sale.incomeTax)],
                    ["지방소득세", won(sale.localIncomeTax)],
                    ["양도세 합계", won(sale.total)],
                    ["순 매각대금(대출·세금 뺀 금액)", won(sale.netProceeds)],
                  ]}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid min-w-0 gap-4 md:grid-cols-2 print:grid-cols-2">
        <div className="min-w-0 space-y-2 break-inside-avoid">
          <h4 className="font-semibold">상속 요약({inheritance.on})</h4>
          <KeyValueTable
            caption={`${plan.label} 상속 요약`}
            rows={[
              ["금융재산", won(inheritance.financialAssets)],
              ["부동산", won(inheritance.realEstate)],
              ["채무", won(inheritance.debts)],
              ["배우자 몫(남은 생활·간병비)", won(inheritance.spouseShare)],
              ["다시 더한 증여(10년)", won(inheritance.priorGiftsAdded)],
              ["과세가액", won(inheritance.taxableValue)],
              ["적용 공제", won(inheritance.appliedDeduction)],
              ["과세표준", won(inheritance.taxBase)],
              ["상속세", won(inheritance.payableTax)],
            ]}
          />
        </div>
        <div className="min-w-0 space-y-3 break-inside-avoid">
          <h4 className="font-semibold">자녀 주택 수 영향</h4>
          {plan.childImpacts.length === 0 ? (
            <p className="text-muted-foreground">이 방안에서 부동산을 그대로 받는 자녀가 없어요.</p>
          ) : (
            <ul className="space-y-3">
              {plan.childImpacts.map((impact) => (
                <li key={impact.childId} className="space-y-1">
                  <p className="font-medium">
                    {recipientName(names, impact.childId)}: {impact.houseCountBefore}채 → {impact.houseCountAfter}채
                  </p>
                  {impact.flags.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                      {impact.flags.map((flag) => (
                        <li key={flag.code}>{flag.message}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="rounded-lg bg-muted/40 p-3">
            자녀에게 남는 금액(참고, {inheritance.on}): <strong className="tabular-nums">{won(plan.childrenReceiveAtHorizon)}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
