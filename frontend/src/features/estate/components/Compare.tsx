"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart } from "@/components/charts/BarChart";
import { ErrorState } from "@/components/common/ErrorState";
import { formatKRW, formatKRWCompact } from "@/lib/format";
import { useCompare, usePrefill } from "../hooks";
import type { Member } from "../types";
import { Assumptions, DataForm, moneyField, Panel } from "./shared";
import { todayKst } from "../utils";

export function Compare({ members }: { members: Member[] }) {
  const query = usePrefill();
  const mutation = useCompare();
  const [message, setMessage] = useState("");
  const children = members.filter((m) => m.relation === "child");
  const grandchildren = members.filter((m) => m.relation === "grandchild");
  const missing = [...children, ...grandchildren].filter((m) => !m.birthDate).length;
  const result = mutation.data;
  return <div className="space-y-4"><Panel title="같은 가정으로 상속·증여 방향 비교"><p className="text-sm text-muted-foreground">가족에게 남는 금액을 참고용으로 비교합니다. 자녀 {children.length}명 · 손자녀 {grandchildren.length}명</p>{missing > 0 && <p className="text-sm">생년월일 없는 가족 {missing}명은 계산에서 제외됩니다.</p>}{!children.length && !grandchildren.length && <p className="rounded-lg bg-muted p-3 text-sm">가족 탭에서 자녀를 등록하면 증여 방향을 비교할 수 있어요</p>}
    <DataForm pending={mutation.isPending} label="방향 비교하기" defaults={{ baseDate: todayKst(), horizonYears: "20", annualGrowthRate: "3", financialAssets: "0", realEstate: "0", otherAssets: "0", debts: "0", spouseAlive: members.some((m) => m.relation === "spouse"), lumpSumPerChild: "100000000" }} fields={[
      { name: "baseDate", label: "기준일", type: "date", required: true },
      { name: "horizonYears", label: "상속 가정 시점", type: "range", min: 1, max: 40 },
      { name: "annualGrowthRate", label: "재산 연 증가율 (%)", type: "number", min: 0, max: 10, step: 0.1 },
      moneyField("financialAssets", "금융재산 (원)"), moneyField("realEstate", "부동산 (원)"), moneyField("otherAssets", "기타 재산 (원)"), moneyField("debts", "채무 (원)"),
      { name: "spouseAlive", label: "배우자가 생존해 있어요", type: "checkbox" }, moneyField("lumpSumPerChild", "자녀 1명당 일시 증여 금액 (원)", 1),
    ]} actions={(form) => <div className="space-y-2"><Button type="button" variant="outline" disabled={query.isPending} onClick={() => {
      const p = query.data;
      if (!p?.assets) { setMessage("자산배분에 자산을 입력하면 자동으로 채워집니다"); return; }
      Object.entries(p.assets).forEach(([name, value]) => form.setValue(name, String(value)));
      form.setValue("spouseAlive", p.spouse);
      setMessage("자산배분에서 점수 계산에서 뺀 자산은 부동산으로 채웠어요. 다르면 고쳐 주세요.");
    }}>내 정보로 채우기</Button>{query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}{message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}</div>} onSubmit={async (v) => {
      await mutation.mutateAsync({ baseDate: v.baseDate, horizonYears: Number(v.horizonYears), annualGrowthRate: String(v.annualGrowthRate), assets: { financialAssets: Number(v.financialAssets), realEstate: Number(v.realEstate), otherAssets: Number(v.otherAssets), debts: Number(v.debts) }, spouseAlive: Boolean(v.spouseAlive), lumpSumPerChild: Number(v.lumpSumPerChild) });
    }} /></Panel>
    {result && <><p className="text-sm text-muted-foreground">{result.horizonDate} 기준 · 연 {result.annualGrowthRate}% 가정 · 참고용</p><div className="grid gap-4 lg:grid-cols-2">{result.scenarios.map((s) => <Panel key={s.key} title={s.label}>{s.key === result.recommendedKey && <Badge className="h-auto whitespace-normal">같은 가정에서 가장 많이 남는 방향</Badge>}<div className="rounded-lg bg-muted p-4"><p className="text-sm text-muted-foreground">가족에게 남는 금액</p><p className="mt-1 break-all text-2xl font-bold tabular-nums">{formatKRW(s.familyReceives)}</p></div><dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm"><dt>총 세금</dt><dd className="break-all text-right tabular-nums">{formatKRW(s.totalTax)}</dd><dt>증여 합계</dt><dd className="break-all text-right tabular-nums">{formatKRW(s.totalGifted)}</dd><dt>증여세</dt><dd className="break-all text-right tabular-nums">{formatKRW(s.giftTaxTotal)}</dd><dt>상속세</dt><dd className="break-all text-right tabular-nums">{formatKRW(s.inheritanceTax)}</dd></dl><details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">증여 일정과 상속세 단계 펼치기</summary><div className="mt-3 space-y-3">{s.gifts.length ? <div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">{s.label} 증여 일정</caption><thead><tr><th className="p-1">가족·날짜</th><th className="p-1">금액</th><th className="p-1">증여세</th></tr></thead><tbody>{s.gifts.map((g, i) => <tr key={i} className="border-t"><td className="p-1">{g.displayName}<br />{g.giftOn}</td><td className="p-1">{formatKRW(g.amount)}</td><td className="p-1">{formatKRW(g.giftTax)}</td></tr>)}</tbody></table></div> : <p>증여 일정 없음</p>}<dl className="grid grid-cols-2 gap-2"><dt>상속재산</dt><dd className="break-all">{formatKRW(s.estateAtHorizon)}</dd><dt>과세가액</dt><dd className="break-all">{formatKRW(s.inheritance.taxableValue)}</dd><dt>적용 공제</dt><dd className="break-all">{formatKRW(s.inheritance.appliedDeduction)}</dd><dt>과세표준</dt><dd className="break-all">{formatKRW(s.inheritance.taxBase)}</dd><dt>납부세액</dt><dd className="break-all">{formatKRW(s.inheritance.payableTax)}</dd></dl></div></details></Panel>)}</div>
    <Panel title="방향별 금액 비교"><BarChart data={result.scenarios.map((s) => ({ name: s.key === "inherit_only" ? "상속" : s.key === "staged_children" ? "자녀 분산" : s.key === "lump_sum_now" ? "일시 증여" : "손자녀 분산", totalTax: s.totalTax, familyReceives: s.familyReceives }))} xKey="name" series={[{ key: "totalTax", label: "총 세금", color: "var(--asset-other)" }, { key: "familyReceives", label: "가족에게 남는 금액", color: "var(--asset-cash)" }]} ariaLabel="방향별 총 세금과 가족에게 남는 금액" valueFormatter={formatKRWCompact} /></Panel><ul className="space-y-2 text-sm text-muted-foreground">{result.notes.map((note) => <li key={note}>{note}</li>)}</ul></>}
    <Assumptions items={result?.assumptions} /></div>;
}
