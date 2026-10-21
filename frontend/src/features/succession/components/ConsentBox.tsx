"use client";

import { useId } from "react";
import { ShieldCheck } from "lucide-react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

export interface ConsentChecks {
  agree: boolean;
  informed: boolean;
}

export const CONSENT_LABEL = "[선택] 부모님 건강 상태(민감정보) 저장에 동의해요";
export const CONSENT_DETAIL =
  "수집 목적: 부모님 기대여명 추정과 이전 방안 계산 / 항목: 부모님 건강 상태 / 보유 기간: 동의를 철회하거나 계정을 삭제할 때까지 / 동의하지 않을 권리가 있고, 동의하지 않아도 계산할 수 있어요. 이 경우 건강 상태는 저장하지 않아요.";
export const INFORMED_LABEL = "건강 정보의 주인인 부모님께 알리고 동의를 받았어요";

interface ConsentBoxProps {
  checks: ConsentChecks;
  onChange: (checks: ConsentChecks) => void;
  consentAt: string | null;
  onWithdraw: () => Promise<void>;
}

export function ConsentBox({ checks, onChange, consentAt, onWithdraw }: ConsentBoxProps) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-dashed bg-muted/30 p-4" role="group" aria-label="민감정보 동의">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4" aria-hidden="true" />
        민감정보 저장 동의
      </p>
      <label className="flex items-start gap-2 text-sm break-keep">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={checks.agree}
          aria-labelledby={`${id}-agree`}
          aria-describedby={`${id}-detail`}
          onChange={(event) => onChange({ ...checks, agree: event.target.checked })}
        />
        <span className="space-y-1">
          <span id={`${id}-agree`} className="block font-medium">
            {CONSENT_LABEL}
          </span>
          <span id={`${id}-detail`} className="block text-xs text-muted-foreground">
            {CONSENT_DETAIL}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm break-keep">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={checks.informed}
          onChange={(event) => onChange({ ...checks, informed: event.target.checked })}
        />
        <span>{INFORMED_LABEL}</span>
      </label>
      <p className="text-xs text-muted-foreground break-keep">
        두 항목에 모두 체크해야 건강 상태를 암호화해 저장해요. 하나라도 비어 있으면 건강 상태 없이 저장해요.
      </p>
      {consentAt && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>동의일 {formatDate(consentAt)}</span>
          <span aria-hidden="true">·</span>
          <ConfirmDialog
            title="민감정보 동의를 철회할까요?"
            description="저장한 부모님 건강 상태와 동의 기록을 바로 지워요. 다른 입력은 그대로 남아요."
            confirmLabel="동의 철회"
            destructive
            onConfirm={onWithdraw}
            trigger={
              <Button type="button" variant="link" size="sm" className="h-auto p-0">
                동의 철회
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
