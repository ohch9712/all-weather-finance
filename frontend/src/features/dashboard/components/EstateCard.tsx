"use client";

import { Landmark } from "lucide-react";
import { Disclaimer } from "@/components/common/Disclaimer";
import { MoneyText } from "@/components/common/MoneyText";
import { formatDate } from "@/lib/format";
import type { EstateSection } from "../types";
import { SectionCard, SectionEmpty } from "./SectionCard";

interface EstateCardProps {
  data: EstateSection | null;
  onRetry: () => void;
  retrying: boolean;
}

/** 자녀·손자녀별 남은 증여재산공제와 다음 회복일 */
export function EstateCard({ data, onRetry, retrying }: EstateCardProps) {
  return (
    <SectionCard
      title="증여 공제"
      icon={Landmark}
      link={{ href: "/estate", label: "상속·증여" }}
      failed={data === null}
      onRetry={onRetry}
      retrying={retrying}
    >
      {data && <EstateBody data={data} />}
    </SectionCard>
  );
}

function EstateBody({ data }: { data: EstateSection }) {
  if (data.members.length === 0) {
    return (
      <SectionEmpty
        message="자녀·손자녀를 등록하면 10년 합산 증여 공제가 얼마나 남았는지 보여 드려요."
        action={{ href: "/estate", label: "가족 등록하기" }}
      />
    );
  }
  return (
    <>
      <ul className="divide-y">
        {data.members.map((member) => (
          <li key={member.memberId} className="flex min-w-0 items-center justify-between gap-3 py-2 first:pt-0">
            <span className="min-w-0 truncate text-sm font-medium">{member.displayName}</span>
            <span className="shrink-0 text-right">
              <span className="block text-sm">
                <span className="text-muted-foreground">남은 공제 </span>
                <MoneyText value={member.available} compact className="font-semibold" />
              </span>
              <span className="block text-xs text-muted-foreground">
                {member.nextResetOn ? `다음 회복일 ${formatDate(member.nextResetOn)}` : "10년 안 증여 기록 없음"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Disclaimer variant="tax" className="mt-auto" />
    </>
  );
}
