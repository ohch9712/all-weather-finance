"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/common/PageHeader";
import { Disclaimer } from "@/components/common/Disclaimer";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { Badge } from "@/components/ui/badge";
import { useMembers } from "../hooks";
import { Families, Gifts, Deductions } from "./FamilyAndGifts";
import { GiftCalculator, InheritanceCalculator, GiftPlan } from "./Calculators";
import { Compare } from "./Compare";

const tabs = [["family", "가족"], ["gifts", "증여 기록"], ["deductions", "공제 현황"], ["gift-tax", "증여세 계산"], ["inheritance", "상속세 추정"], ["plan", "분산 증여 플랜"], ["compare", "방향 비교"]] as const;
export function EstatePage() {
  const params = useSearchParams();
  const current = tabs.some(([key]) => key === params.get("tab")) ? params.get("tab") : "family";
  const query = useMembers();
  const members = query.data?.items ?? [];
  return <div className="min-w-0 space-y-5"><PageHeader title="상속·증여 플래너" description="가족의 공제 현황과 세금을 살펴보고, 같은 가정에서 자산을 전하는 방향을 비교해 보세요." actions={<Badge variant="outline">2024.01.01 시행 세법 기준</Badge>} /><div className="rounded-xl border bg-muted/30 p-4"><Disclaimer variant="tax" /></div>
    <nav aria-label="상속·증여 메뉴" className="flex flex-wrap gap-2">{tabs.map(([key, label]) => <Link key={key} href={`/estate?tab=${key}`} aria-current={key === current ? "page" : undefined} className={`rounded-lg border px-3 py-2 text-sm font-medium ${key === current ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>{label}</Link>)}</nav>
    {query.isPending ? <LoadingState /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : <div key={current}>{current === "family" && <Families members={members} />}{current === "gifts" && <Gifts members={members} />}{current === "deductions" && <Deductions members={members} />}{current === "gift-tax" && <GiftCalculator members={members} />}{current === "inheritance" && <InheritanceCalculator />}{current === "plan" && <GiftPlan members={members} />}{current === "compare" && <Compare members={members} />}</div>}
  </div>;
}
