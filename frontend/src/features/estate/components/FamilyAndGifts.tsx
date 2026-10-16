"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { formatKRW } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-client";
import { useDeductions, useEstateWrite, useGifts } from "../hooks";
import type { Gift, Member, Relation } from "../types";
import { allowedGroups, assetLabels, categoryLabels, donorLabels, relationLabels, todayKst } from "../utils";
import { Assumptions, DataForm, moneyField, options, Panel, type Field, type Values } from "./shared";

export function MemberSelect({ members, value, onChange, direct = false }: { members: Member[]; value: string; onChange: (value: string) => void; direct?: boolean }) {
  return <label className="block space-y-2 text-sm font-medium">수증자 선택<select aria-label="수증자 선택" className="h-10 w-full rounded-lg border bg-background px-2 font-normal" value={value} onChange={(e) => onChange(e.target.value)}><option value="">{direct ? "직접 입력" : "가족을 선택해 주세요"}</option>{members.map((m) => <option key={m.id} value={m.id}>{m.displayName} · {relationLabels[m.relation]}</option>)}</select></label>;
}
const memberDefaults = (m?: Member): Values => ({ relation: m?.relation ?? "child", displayName: m?.displayName ?? "", birthDate: m?.birthDate ?? "", marriedOn: m?.marriedOn ?? "", childBirthDates: m?.childBirthDates.join(", ") ?? "", parentDeceased: m?.parentDeceased ?? false });
export function Families({ members }: { members: Member[] }) {
  const [editing, setEditing] = useState<Member | null | undefined>(undefined);
  const write = useEstateWrite();
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">실명 대신 가족 별칭을 사용해 주세요.</p><Button onClick={() => setEditing(null)}>가족 추가</Button></div>
    {!members.length && <EmptyState title="등록된 가족이 없어요" description="가족을 등록하면 공제 현황과 상속·증여 방향을 함께 볼 수 있어요." />}
    <div className="grid gap-4 md:grid-cols-2">{members.map((m) => <Panel key={m.id}><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{m.displayName}</h2><Badge variant="secondary">{relationLabels[m.relation]}</Badge>{m.isMinor && <Badge variant="outline">미성년</Badge>}</div><p className="text-sm text-muted-foreground">{m.age === null ? "생년월일 미등록" : `만 ${m.age}세 · ${m.birthDate}`}</p><div className="flex gap-2"><Button aria-label={`수정 ${m.displayName}`} variant="outline" size="sm" onClick={() => setEditing(m)}>수정<span className="sr-only"> {m.displayName}</span></Button><ConfirmDialog title="가족을 삭제할까요?" description="이 가족의 증여 기록도 함께 삭제됩니다." confirmLabel="삭제" destructive trigger={<Button aria-label={`삭제 ${m.displayName}`} variant="ghost" size="sm">삭제<span className="sr-only"> {m.displayName}</span></Button>} onConfirm={async () => { try { await write.mutateAsync({ kind: "deleteMember", id: m.id }); toast.success("가족을 삭제했어요."); } catch (e) { toast.error(getErrorMessage(e)); } }} /></div></Panel>)}</div>
    <Dialog open={editing !== undefined} onOpenChange={(open) => { if (!open) setEditing(undefined); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{editing ? "가족 수정" : "가족 추가"}</DialogTitle><DialogDescription>자녀·손자녀는 생년월일이 필수입니다. 별칭을 권장합니다.</DialogDescription></DialogHeader>
      {editing !== undefined && <DataForm defaults={memberDefaults(editing ?? undefined)} label="저장" pending={write.isPending} fields={(v) => [
        { name: "relation", label: "관계", options: options(relationLabels) },
        { name: "displayName", label: "별칭", required: true },
        { name: "birthDate", label: "생년월일", type: "date", required: ["child", "grandchild"].includes(String(v.relation)) },
        { name: "marriedOn", label: "혼인신고일", type: "date" },
        { name: "childBirthDates", label: "자녀 출생·입양일", type: "textarea", hint: "YYYY-MM-DD 형식으로 쉼표로 구분해 최대 10개를 입력하세요." },
        ...(v.relation === "grandchild" ? [{ name: "parentDeceased", label: "수증자의 부모가 사망했어요 (세대생략 할증 제외)", type: "checkbox" as const }] : []),
      ]} onSubmit={async (v) => { await write.mutateAsync({ kind: "member", id: editing?.id, data: { ...v, birthDate: v.birthDate || null, marriedOn: v.marriedOn || null, childBirthDates: String(v.childBirthDates).split(/[,\n]/).map((s) => s.trim()).filter(Boolean), parentDeceased: v.relation === "grandchild" && Boolean(v.parentDeceased) } }); setEditing(undefined); toast.success("가족을 저장했어요."); }} />}
    </DialogContent></Dialog><Assumptions /></div>;
}
export function Gifts({ members }: { members: Member[] }) {
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState<Gift | null | undefined>(undefined);
  const query = useGifts(selected);
  const write = useEstateWrite();
  const member = members.find((m) => m.id === selected);
  const groups = member ? allowedGroups[member.relation] : [];
  const fields: Field[] = [
    { name: "giftedOn", label: "증여일", type: "date", required: true },
    { name: "donorGroup", label: "증여자 그룹", options: groups.map((value) => ({ value, label: donorLabels[value] })) },
    { name: "assetType", label: "재산 종류", options: options(assetLabels) },
    moneyField("amount", "증여 금액 (원)", 1), moneyField("appraisalFee", "감정평가수수료 (원)"), moneyField("taxPaid", "실제 낸 세금 (원)"),
    { name: "marriageBirthClaimed", label: "혼인·출산 공제를 신청했어요", type: "checkbox" },
    { name: "filed", label: "신고했어요", type: "checkbox" }, { name: "memo", label: "메모", type: "textarea" },
  ];
  return <div className="space-y-4"><Panel><MemberSelect members={members} value={selected} onChange={setSelected} /><Button disabled={!member} onClick={() => setEditing(null)}>증여 기록 추가</Button></Panel>
    {query.isLoading && <LoadingState />}{query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
    {!selected ? <EmptyState title="수증자를 선택해 주세요" /> : query.data?.items.length === 0 ? <EmptyState title="증여 기록이 없어요" /> : query.data && <Panel title={`${member?.displayName}의 증여 기록`}><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b">{["날짜", "증여자", "재산", "금액", "적용 공제", "추정 세액", "낸 세금", "신고", "관리"].map((s) => <th key={s} className="whitespace-nowrap p-2">{s}</th>)}</tr></thead><tbody>{query.data.items.map((g) => <tr key={g.id} className="border-b"><td className="whitespace-nowrap p-2">{g.giftedOn}</td><td className="p-2">{donorLabels[g.donorGroup]}</td><td className="p-2">{assetLabels[g.assetType]}</td><td className="p-2">{formatKRW(g.amount)}</td><td className="p-2">{formatKRW(g.computedDeduction + g.computedMarriageBirthDeduction)}</td><td className="p-2">{formatKRW(g.estimatedTax)}</td><td className="p-2">{formatKRW(g.taxPaid)}</td><td className="p-2">{g.filed ? "완료" : "미신고"}</td><td className="p-2"><div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => setEditing(g)}>수정</Button><ConfirmDialog title="증여 기록을 삭제할까요?" description="공제 현황이 다시 계산됩니다." confirmLabel="삭제" destructive trigger={<Button variant="ghost" size="sm">삭제</Button>} onConfirm={async () => { try { await write.mutateAsync({ kind: "deleteGift", id: g.id }); } catch (e) { toast.error(getErrorMessage(e)); } }} /></div></td></tr>)}</tbody></table></div></Panel>}
    <Dialog open={editing !== undefined} onOpenChange={(open) => { if (!open) setEditing(undefined); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{editing ? "증여 기록 수정" : "증여 기록 추가"}</DialogTitle><DialogDescription>날짜순 기록으로 공제를 다시 계산합니다.</DialogDescription></DialogHeader>{editing !== undefined && <DataForm fields={fields} label="저장" pending={write.isPending} defaults={{ giftedOn: editing?.giftedOn ?? todayKst(), donorGroup: editing?.donorGroup ?? groups[0] ?? "parents", assetType: editing?.assetType ?? "cash", amount: String(editing?.amount ?? 0), appraisalFee: String(editing?.appraisalFee ?? 0), taxPaid: String(editing?.taxPaid ?? 0), marriageBirthClaimed: editing?.marriageBirthClaimed ?? false, filed: editing?.filed ?? false, memo: editing?.memo ?? "" }} onSubmit={async (v) => { await write.mutateAsync({ kind: "gift", id: editing?.id, data: { ...v, recipientId: selected, amount: Number(v.amount), appraisalFee: Number(v.appraisalFee), taxPaid: Number(v.taxPaid), memo: v.memo || null } }); setEditing(undefined); toast.success("증여 기록을 저장했어요."); }} />}</DialogContent></Dialog><Assumptions /></div>;
}
function DeductionCard({ member }: { member: Member }) {
  const query = useDeductions(member.id);
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const status = query.data;
  if (!status) return null;
  return <Panel title={`${member.displayName} · ${relationLabels[member.relation]}`}><p className="text-xs text-muted-foreground">기준일 {status.asOf}{status.adultOn && ` · 성년 전환일 ${status.adultOn}`}</p>{status.pools.map((pool) => <div key={pool.category} className="space-y-2"><p className="text-sm font-medium">{categoryLabels[pool.category]}</p><progress aria-label={`${member.displayName} ${categoryLabels[pool.category]} 사용액`} max={pool.limit || 1} value={pool.usedWithin10y} className="h-2 w-full accent-primary" /><p className="text-sm">사용 {formatKRW(pool.usedWithin10y)} · 남음 {formatKRW(pool.available)}</p><p className="text-xs text-muted-foreground">다음 공제 회복일: {pool.nextResetOn ?? "사용한 공제 없음"}</p></div>)}<div className="rounded-lg bg-muted p-3 text-sm"><p className="font-medium">혼인·출산 공제 · {status.marriageBirth.eligibleNow ? "현재 기간 충족" : "현재 기간 미충족"}</p><p>사용 {formatKRW(status.marriageBirth.used)} · 남음 {formatKRW(status.marriageBirth.available)}</p>{status.marriageBirth.windows.map((w, i) => <p key={i} className="mt-1 text-xs">{w.kind === "marriage" ? "혼인" : "출산·입양"}: {w.from} ~ {w.to}</p>)}</div></Panel>;
}
export function Deductions({ members }: { members: Member[] }) {
  return <div className="space-y-4">{!members.length && <EmptyState title="가족을 먼저 등록해 주세요" />}<div className="grid gap-4 lg:grid-cols-2">{members.map((m) => <DeductionCard key={m.id} member={m} />)}</div><Assumptions /></div>;
}
export function relationFrom(value: string | boolean): Relation { return value as Relation; }
