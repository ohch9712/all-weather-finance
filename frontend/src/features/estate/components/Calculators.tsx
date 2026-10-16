"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LineChart } from "@/components/charts/LineChart";
import { ErrorState } from "@/components/common/ErrorState";
import { formatKRW, formatKRWCompact } from "@/lib/format";
import { useGiftPlan, useGiftTax, useInheritanceTax, usePrefill } from "../hooks";
import type { Member, Recipient, Relation } from "../types";
import { allowedGroups, donorLabels, relationLabels, todayKst } from "../utils";
import { Assumptions, DataForm, moneyField, options, Panel, TaxSteps, type Values } from "./shared";
import { MemberSelect } from "./FamilyAndGifts";

function shiftYear(value: string, years: number) {
  const day = new Date(value + "T00:00:00Z");
  const month = day.getUTCMonth();
  day.setUTCFullYear(day.getUTCFullYear() + years);
  if (day.getUTCMonth() !== month) day.setUTCDate(0);
  return day.toISOString().slice(0, 10);
}
function marriageEligible(recipient: Recipient | undefined, values: Values) {
  const day = String(values.giftedOn);
  const relation = recipient?.relation ?? String(values.relation);
  if (!["child", "grandchild"].includes(relation)) return false;
  const marriedOn = recipient?.marriedOn ?? String(values.marriedOn || "");
  const births = recipient?.childBirthDates ?? String(values.childBirthDates || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return Boolean((marriedOn && /^\d{4}-\d{2}-\d{2}$/.test(marriedOn) && shiftYear(marriedOn, -2) <= day && day <= shiftYear(marriedOn, 2)) || births.some((b) => /^\d{4}-\d{2}-\d{2}$/.test(b) && b <= day && day <= shiftYear(b, 2)));
}
export function GiftCalculator({ members }: { members: Member[] }) {
  const [selected, setSelected] = useState("");
  const member = members.find((m) => m.id === selected);
  const mutation = useGiftTax();
  return <div className="space-y-4"><Panel title="증여세 계산"><MemberSelect members={members} value={selected} onChange={(value) => { setSelected(value); mutation.reset(); }} direct />
    <DataForm key={selected} defaults={{ relation: "child", birthDate: "1996-05-01", marriedOn: "", childBirthDates: "", parentDeceased: false, donorGroup: member ? allowedGroups[member.relation][0] : "parents", giftedOn: todayKst(), amount: "100000000", appraisalFee: "0", claimMarriageBirth: false, useRecords: true }} pending={mutation.isPending} fields={(v) => {
      const relation = member?.relation ?? v.relation as Relation;
      const groups = allowedGroups[relation];
      return [
        ...(!member ? [
          { name: "relation", label: "수증자 관계", options: options(relationLabels) },
          { name: "birthDate", label: "수증자 생년월일", type: "date" as const, required: ["child", "grandchild"].includes(relation) },
          { name: "marriedOn", label: "혼인신고일", type: "date" as const },
          { name: "childBirthDates", label: "자녀 출생·입양일", hint: "YYYY-MM-DD, 쉼표로 구분" },
          ...(relation === "grandchild" ? [{ name: "parentDeceased", label: "수증자의 부모가 사망했어요", type: "checkbox" as const }] : []),
        ] : [{ name: "useRecords", label: "등록한 증여 기록을 반영해요", type: "checkbox" as const }]),
        { name: "donorGroup", label: "증여자 그룹", options: groups.map((value) => ({ value, label: donorLabels[value] })) },
        { name: "giftedOn", label: "증여일", type: "date" as const, required: true },
        moneyField("amount", "증여 금액 (원)", 1), moneyField("appraisalFee", "감정평가수수료 (원)"),
        { name: "claimMarriageBirth", label: "혼인·출산 공제를 신청해요", type: "checkbox" as const, disabled: !marriageEligible(member, v) || !["parents", "grandparents"].includes(String(v.donorGroup)), hint: "직계존속 증여이며 혼인 전후 2년 또는 출생·입양 후 2년 안일 때 선택할 수 있어요." },
      ];
    }} onSubmit={async (v) => { await mutation.mutateAsync({ ...(member ? { memberId: member.id, useRecords: v.useRecords } : { recipient: { relation: v.relation, birthDate: v.birthDate || null, marriedOn: v.marriedOn || null, childBirthDates: String(v.childBirthDates).split(/[,\n]/).map((s) => s.trim()).filter(Boolean), parentDeceased: v.relation === "grandchild" && Boolean(v.parentDeceased) }, priorGifts: [] }), donorGroup: v.donorGroup, giftedOn: v.giftedOn, amount: Number(v.amount), appraisalFee: Number(v.appraisalFee), claimMarriageBirth: marriageEligible(member, v) && Boolean(v.claimMarriageBirth) }); }} />
  </Panel>{mutation.data ? <TaxSteps result={mutation.data} /> : <Assumptions />}</div>;
}
const inheritanceMoney = [
  moneyField("financialAssets", "금융재산 (원)"), moneyField("realEstate", "부동산 (원)"), moneyField("otherAssets", "기타 재산 (원)"), moneyField("debts", "채무 (원)"), moneyField("financialDebts", "금융채무 (원)"), moneyField("funeralExpense", "장례비 (원)"), moneyField("enshrinementExpense", "봉안비 (원)"), moneyField("priorGiftsToHeirs10y", "상속인 사전증여 · 10년 (원)"), moneyField("priorGiftsToNonHeirs5y", "상속인 외 사전증여 · 5년 (원)"), moneyField("priorGiftDeductions", "사전증여의 증여재산공제 (원)"), moneyField("priorGiftTaxPaid", "사전증여 납부세액 (원)"), moneyField("appraisalFee", "감정평가수수료 (원)"), moneyField("houseValue", "동거주택 가액 (원)"),
];
export function InheritanceCalculator() {
  const query = usePrefill();
  const mutation = useInheritanceTax();
  const [message, setMessage] = useState("");
  return <div className="space-y-4"><Panel title="상속세 추정"><DataForm defaults={{ ...Object.fromEntries(inheritanceMoney.map((f) => [f.name, "0"])), spouseAlive: true, spouseActualShare: "", children: "35, 32", elderlyDependents: "0", houseEligible: false }} fields={[
    ...inheritanceMoney,
    { name: "spouseAlive", label: "배우자가 생존해 있어요", type: "checkbox" },
    { name: "spouseActualShare", label: "배우자 실제 상속액 (원, 선택)", hint: "비워 두면 법정 상속분을 사용합니다." },
    { name: "children", label: "자녀 나이 (만 나이)", hint: "쉼표 구분. 장애인 공제는 나이:기대여명 연수 (예: 35:20, 32). 자녀가 없으면 비워 주세요." },
    { name: "elderlyDependents", label: "65세 이상 부양가족 수", type: "number", min: 0, max: 100 },
    { name: "houseEligible", label: "동거주택 상속공제 요건을 충족해요", type: "checkbox" },
  ]} pending={mutation.isPending} actions={(form) => <div className="space-y-2"><Button type="button" variant="outline" disabled={query.isPending} onClick={() => {
    const p = query.data;
    if (!p?.assets) { setMessage("자산배분에 자산을 입력하면 자동으로 채워집니다"); return; }
    Object.entries(p.assets).forEach(([name, value]) => form.setValue(name, String(value)));
    form.setValue("spouseAlive", p.spouse);
    form.setValue("children", p.children.filter((c) => c.age !== null).map((c) => c.age).join(", "));
    for (const name of ["priorGiftsToHeirs10y", "priorGiftsToNonHeirs5y", "priorGiftDeductions", "priorGiftTaxPaid"] as const) form.setValue(name, String(p[name]));
    setMessage("자산배분에서 점수 계산에서 뺀 자산은 부동산으로 채웠어요. 다르면 고쳐 주세요.");
  }}>내 정보로 채우기</Button>{query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}{message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}</div>} onSubmit={async (v) => {
    const children = String(v.children).split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [age, years] = s.split(":"); return { age: Number(age), disabledLifeExpectancyYears: years ? Number(years) : null }; });
    await mutation.mutateAsync({ ...Object.fromEntries(inheritanceMoney.filter((f) => f.name !== "houseValue").map((f) => [f.name, Number(v[f.name])])), spouseAlive: Boolean(v.spouseAlive), spouseActualShare: v.spouseActualShare === "" ? null : Number(v.spouseActualShare), children, elderlyDependents: Number(v.elderlyDependents), cohabitingHouse: { eligible: Boolean(v.houseEligible), value: Number(v.houseValue) } });
  }} /></Panel>{mutation.data ? <TaxSteps result={mutation.data} /> : <Assumptions />}</div>;
}
export function GiftPlan({ members }: { members: Member[] }) {
  const [selected, setSelected] = useState("");
  const [rate, setRate] = useState(4);
  const mutation = useGiftPlan();
  const eligibleMembers = members.filter((m) => ["child", "grandchild"].includes(m.relation) && m.birthDate);
  const result = mutation.data;
  let cumulative = 0;
  const chart = result?.schedule.map((g) => { cumulative += g.amount; return { date: g.giftOn, cumulative, futureValue: Math.floor(result.schedule.filter((x) => x.giftOn <= g.giftOn).reduce((sum, x) => sum + x.amount * (1 + rate / 100) ** ((Date.parse(g.giftOn) - Date.parse(x.giftOn)) / 86400000 / 365), 0)) }; }) ?? [];
  if (result) chart.push({ date: result.endDate, cumulative: result.totalGifted, futureValue: result.futureValue });
  return <div className="space-y-4"><Panel title="분산 증여 플랜"><MemberSelect members={eligibleMembers} value={selected} onChange={(value) => { setSelected(value); mutation.reset(); }} direct /><DataForm key={selected} pending={mutation.isPending} defaults={{ birthDate: "2026-01-01", startDate: todayKst(), targetAge: "30", annualReturnRate: "4", donorGroup: eligibleMembers.find((m) => m.id === selected)?.relation === "grandchild" ? "grandparents" : "parents", expectedMarriageDate: "" }} fields={[
    ...(!selected ? [{ name: "birthDate", label: "수증자 생년월일", type: "date" as const, required: true }] : []),
    { name: "startDate", label: "시작일", type: "date", required: true },
    { name: "targetAge", label: "목표 나이", type: "range", min: 19, max: 40 },
    { name: "annualReturnRate", label: "연 기대수익률 (%)", type: "number", min: 0, max: 20, step: 0.1 },
    { name: "donorGroup", label: "증여자 그룹", options: [{ value: "parents", label: "부모" }, { value: "grandparents", label: "조부모" }] },
    { name: "expectedMarriageDate", label: "예상 혼인일", type: "date" },
  ]} label="플랜 계산" onSubmit={async (v) => { await mutation.mutateAsync({ ...(selected ? { memberId: selected } : { birthDate: v.birthDate }), startDate: v.startDate, targetAge: Number(v.targetAge), annualReturnRate: String(v.annualReturnRate), donorGroup: v.donorGroup, expectedMarriageDate: v.expectedMarriageDate || null }); setRate(Number(v.annualReturnRate)); }} /></Panel>
    {result && <><Panel title="분산 증여 일정"><p className="text-sm text-muted-foreground">끝나는 날 {result.endDate}</p><ol className="space-y-3 border-l-2 pl-4">{result.schedule.map((g, i) => <li key={i} className="rounded-lg bg-muted p-3 text-sm"><p className="font-medium">{g.giftOn} · 만 {g.age}세 · {g.deductionType === "marriage" ? "혼인 공제" : "기본 공제"}</p><p>{formatKRW(g.amount)} · 예상 세금 {formatKRW(g.tax)}</p></li>)}</ol><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-4"><p className="font-semibold">분산 증여</p><p>합계 {formatKRW(result.totalGifted)}</p><p>세금 {formatKRW(result.totalTax)}</p><p className="mt-2 text-lg font-bold">미래가치 {formatKRWCompact(result.futureValue)}</p></div><div className="rounded-lg border p-4"><p className="font-semibold">끝나는 날 한 번에 증여</p><p>과세표준 {formatKRW(result.lumpSum.taxBase)}</p><p>예상 세금 {formatKRW(result.lumpSum.payableTax)}</p></div></div><LineChart data={chart} xKey="date" series={[{ key: "cumulative", label: "누적 증여액", color: "var(--asset-cash)" }, { key: "futureValue", label: "미래가치", color: "var(--asset-stock)" }]} ariaLabel="누적 증여액과 미래가치" valueFormatter={formatKRWCompact} /></Panel></>}
    <Assumptions items={result?.assumptions} /></div>;
}
