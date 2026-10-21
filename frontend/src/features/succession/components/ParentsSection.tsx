"use client";

import { useId, useState } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getErrorMessage } from "@/lib/api-client";
import { parseInteger, type SuccessionForm } from "../form";
import { useLifeExpectancy } from "../hooks";
import { HEALTH_LABELS, ROLE_LABELS } from "../utils";
import { MoneyField, Section, SelectField, TextField, useFieldError } from "./fields";

const HEALTH_OPTIONS = [
  { value: "", label: "선택 안 함" },
  ...Object.entries(HEALTH_LABELS).map(([value, label]) => ({ value, label })),
];

function LifeExpectancy({ index }: { index: number }) {
  const { setValue } = useFormContext<SuccessionForm>();
  const parent = useWatch<SuccessionForm, `parents.${number}`>({ name: `parents.${index}` });
  const [editing, setEditing] = useState(Boolean(parent.lifeExpectancyYears));
  const query = useLifeExpectancy(parent.role, parseInteger(parent.age), parent.health || null);
  const info = query.data;
  return (
    <div className="min-w-0 space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
      <p className="font-medium">기대여명</p>
      {parseInteger(parent.age) === null ? (
        <p className="text-muted-foreground">나이를 넣으면 기대여명을 보여 드려요.</p>
      ) : query.isError ? (
        <p role="alert" className="text-destructive">{getErrorMessage(query.error)}</p>
      ) : info ? (
        <p className="tabular-nums" data-testid={`life-expectancy-${parent.role}`}>
          통계 {info.tableLifeExpectancy}년 × 건강 {info.healthFactor} = {info.lifeExpectancy}년
        </p>
      ) : (
        <p className="text-muted-foreground">기대여명을 불러오는 중…</p>
      )}
      <p className="text-xs text-muted-foreground break-keep">
        통계는 국가데이터처 2024년 생명표, 건강 보정은 통계 근거가 없는 앱 가정값이에요.
      </p>
      {editing ? (
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <TextField
            name={`parents.${index}.lifeExpectancyYears`}
            label="직접 고친 기대여명(년)"
            decimal
            className="min-w-0 flex-1"
            hint="0.5~60년. 비우면 통계 × 건강 값을 써요."
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setValue(`parents.${index}.lifeExpectancyYears`, "", { shouldDirty: true });
              setEditing(false);
            }}
          >
            통계값 쓰기
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
          직접 고치기
        </Button>
      )}
    </div>
  );
}

function ParentCard({ index }: { index: number }) {
  const id = useId();
  const { control } = useFormContext<SuccessionForm>();
  const parent = useWatch<SuccessionForm, `parents.${number}`>({ name: `parents.${index}` });
  const label = ROLE_LABELS[parent.role];
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border p-4">
      <legend className="px-1 text-base font-semibold">{label}</legend>
      <div className="flex items-center gap-2">
        <Controller
          control={control}
          name={`parents.${index}.alive`}
          render={({ field }) => (
            <Switch id={id} checked={field.value} onCheckedChange={field.onChange} aria-label={`${label} 살아 계세요`} />
          )}
        />
        <label htmlFor={id} className="text-sm">
          살아 계세요
        </label>
      </div>
      {parent.alive ? (
        <div className="grid min-w-0 gap-3">
          <TextField name={`parents.${index}.age`} label={`${label} 나이(만)`} numeric required hint="40~110세" />
          <SelectField
            name={`parents.${index}.health`}
            label={`${label} 건강 상태`}
            options={HEALTH_OPTIONS}
            hint="민감정보예요. 아래에서 따로 동의해야 저장돼요."
          />
          <LifeExpectancy index={index} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">돌아가신 분의 나이·건강 상태는 계산에 쓰지 않아요.</p>
      )}
    </fieldset>
  );
}

export function ParentsSection() {
  const { register } = useFormContext<SuccessionForm>();
  const parents = useWatch<SuccessionForm, "parents">({ name: "parents" });
  const ownerError = useFieldError("ownerRole");
  const parentsError = useFieldError("parents");
  return (
    <Section title="1. 부모님" description="부모님 나이와 건강 상태로 기대여명을 추정하고, 앞으로의 생활비·간병비를 먼저 떼어 둬요.">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        {parents.map((parent, index) => (
          <ParentCard key={parent.role} index={index} />
        ))}
      </div>
      {parentsError && (
        <p role="alert" className="text-sm text-destructive">
          {parentsError}
        </p>
      )}
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium">재산 명의자</legend>
        <div className="flex flex-wrap gap-4">
          {parents.map((parent) => (
            <label key={parent.role} className="flex items-center gap-2 text-sm">
              <input type="radio" value={parent.role} className="size-4 accent-primary" {...register("ownerRole")} />
              {ROLE_LABELS[parent.role]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">공동명의 재산도 명의자 한 분의 재산으로 합쳐 계산해요.</p>
        {ownerError && (
          <p role="alert" className="text-xs text-destructive">
            {ownerError}
          </p>
        )}
      </fieldset>
      <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        <MoneyField name="monthlyLivingCost" label="부모님 월 생활비" />
        <MoneyField name="monthlyIncome" label="부모님 월 수입(연금 등)" />
        <TextField name="parentsHouseCount" label="부모님 세대 주택 수" numeric hint="입력한 주택 수 이상으로 넣어 주세요." />
      </div>
    </Section>
  );
}
