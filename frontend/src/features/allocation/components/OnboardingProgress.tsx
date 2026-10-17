"use client";

import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ONBOARDING_STEPS } from "../constants";

/** `?onboarding=1`로 들어왔는지. 이 훅을 쓰는 컴포넌트는 Suspense 안에 둔다(useSearchParams). */
export function useIsOnboarding(): boolean {
  return useSearchParams().get("onboarding") === "1";
}

/** 온보딩 단계 표시. 예: "1/3 투자성향" */
export function OnboardingProgress({ step }: { step: 1 | 2 | 3 }) {
  const total = ONBOARDING_STEPS.length;
  return (
    <nav aria-label="온보딩 진행" className="mb-4 space-y-2">
      <p className="text-sm font-medium">
        <span className="tabular-nums">
          {step}/{total}
        </span>{" "}
        {ONBOARDING_STEPS[step - 1]}
      </p>
      <ol className="grid grid-cols-3 gap-1.5">
        {ONBOARDING_STEPS.map((label, index) => (
          <li key={label} aria-current={index + 1 === step ? "step" : undefined}>
            <span className={cn("block h-1.5 rounded-full", index < step ? "bg-primary" : "bg-muted")} />
            <span className="mt-1 block truncate text-xs text-muted-foreground">{label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
