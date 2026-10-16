import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type DisclaimerVariant = "investment" | "tax" | "sample" | "ai";

// 고지 문구(architecture 13절). 글자 하나도 바꾸지 않는다.
export const DISCLAIMER_TEXT: Record<DisclaimerVariant, string> = {
  investment:
    "이 서비스의 자산배분·종목 정보는 일반적인 정보 제공과 학습을 위한 것이며 투자 권유가 아닙니다. 투자 결정과 그 결과의 책임은 본인에게 있습니다.",
  tax: "세금 계산 결과는 입력값과 2026년 10월 기준 세법을 단순화해 추정한 참고용입니다. 실제 신고 전에는 세무 전문가와 상담하세요.",
  sample: "샘플 데이터입니다. 실제 시세가 아닙니다.",
  ai: "AI 답변은 틀릴 수 있습니다. 중요한 결정 전에는 원문 자료를 확인하세요.",
};

interface DisclaimerProps {
  variant: DisclaimerVariant;
  className?: string;
}

export function Disclaimer({ variant, className }: DisclaimerProps) {
  return (
    <p
      role="note"
      data-variant={variant}
      className={cn("flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground break-keep", className)}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{DISCLAIMER_TEXT[variant]}</span>
    </p>
  );
}
