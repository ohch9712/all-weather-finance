"use client";

import { RotateCcw } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { DEFAULT_ASSUMPTIONS, type SuccessionForm } from "../form";
import { ASSUMPTION_HINTS } from "../utils";
import { MoneyField, Section, TextField } from "./fields";

export function AssumptionsSection() {
  const { setValue } = useFormContext<SuccessionForm>();
  function restore() {
    (Object.keys(DEFAULT_ASSUMPTIONS) as (keyof typeof DEFAULT_ASSUMPTIONS)[]).forEach((key) =>
      setValue(`assumptions.${key}`, DEFAULT_ASSUMPTIONS[key], { shouldDirty: true, shouldValidate: true }),
    );
  }
  return (
    <Section
      title="4. 가정값"
      description="앞으로의 재산 가치와 비용은 아래 가정으로 계산해요. 상황에 맞게 고칠 수 있어요."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={restore}>
          <RotateCcw aria-hidden="true" />
          기본값으로 되돌리기
        </Button>
      }
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField name="assumptions.annualGrowthRate" label="재산 연 증가율(%)" decimal hint={`0~10%. ${ASSUMPTION_HINTS.annualGrowthRate}`} />
        <TextField name="assumptions.costInflationRate" label="생활비·간병비 연 상승률(%)" decimal hint={`0~10%. ${ASSUMPTION_HINTS.costInflationRate}`} />
        <MoneyField name="assumptions.careMonthlyCost" label="월 간병비" hint={ASSUMPTION_HINTS.careMonthlyCost} />
        <TextField name="assumptions.careYears" label="간병 기간(년)" numeric hint={`0~20년, 기대여명 마지막 해들에 넣어요. ${ASSUMPTION_HINTS.careYears}`} />
        <TextField name="assumptions.officialPriceRatio" label="공시가격 비율(%)" decimal hint={`10~100%. 공시가격을 비운 부동산에 써요. ${ASSUMPTION_HINTS.officialPriceRatio}`} />
        <TextField
          name="assumptions.survivorLivingRatio"
          label="한 분만 계실 때 생활비 비율(%)"
          decimal
          hint={`10~100%. 두 분 중 한 분만 계시게 된 해부터 월 생활비에 곱해요. ${ASSUMPTION_HINTS.survivorLivingRatio}`}
        />
        <TextField
          name="assumptions.survivorIncomeRatio"
          label="한 분만 계실 때 수입 비율(%)"
          decimal
          hint={`0~100%. 두 분 중 한 분만 계시게 된 해부터 월 수입에 곱해요. ${ASSUMPTION_HINTS.survivorIncomeRatio}`}
        />
        <TextField name="baseDate" label="기준일" type="date" hint="비우면 오늘(한국 시간)이에요. 2026-05-10 이후만 계산할 수 있어요." />
      </div>
    </Section>
  );
}
