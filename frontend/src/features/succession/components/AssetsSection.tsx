"use client";

import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { emptyAsset, MAX_ASSETS, type SuccessionForm } from "../form";
import { KIND_LABELS, REGIONS, REGULATED_HINT } from "../utils";
import { CheckField, MoneyField, Section, SelectField, TextField, useFieldError } from "./fields";

const KIND_OPTIONS = Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }));
const REGION_OPTIONS = [{ value: "", label: "선택 안 함" }, ...REGIONS.map((region) => ({ value: region, label: region }))];

function AssetCard({ index, onRemove, removable }: { index: number; onRemove: () => void; removable: boolean }) {
  const { setValue } = useFormContext<SuccessionForm>();
  const asset = useWatch<SuccessionForm, `assets.${number}`>({ name: `assets.${index}` });
  const ratio = useWatch<SuccessionForm, "assumptions.officialPriceRatio">({ name: "assumptions.officialPriceRatio" });
  const realEstate = asset.kind !== "cash";
  const name = asset.label.trim() || `재산 ${index + 1}`;
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border p-4" aria-label={name}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-base font-semibold">{name}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={!removable} aria-label={`삭제 ${name}`}>
          <Trash2 aria-hidden="true" />
          삭제
        </Button>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <SelectField name={`assets.${index}.kind`} label="종류" options={KIND_OPTIONS} />
        <TextField name={`assets.${index}.label`} label="이름" required placeholder={realEstate ? "예: 임대 아파트" : "예: 예금"} />
        <MoneyField name={`assets.${index}.value`} label={realEstate ? "시가" : "금액"} required />
        <MoneyField name={`assets.${index}.loan`} label="대출" />
      </div>
      {realEstate && (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <SelectField
            name={`assets.${index}.region`}
            label="소재 시·도"
            options={REGION_OPTIONS}
            onChange={(value) => {
              if (value === "서울") setValue(`assets.${index}.regulated`, true, { shouldDirty: true });
            }}
          />
          <div className="sm:pt-6">
            <CheckField name={`assets.${index}.regulated`} label="조정대상지역" hint={REGULATED_HINT} />
          </div>
          <MoneyField
            name={`assets.${index}.officialPrice`}
            label="공시가격(선택)"
            hint={`비우면 시가의 ${ratio || "70"}%로 계산해요.`}
          />
          <TextField name={`assets.${index}.acquiredOn`} label="취득일(선택)" type="date" hint="매각안 계산에 필요해요." />
          <MoneyField
            name={`assets.${index}.acquisitionCost`}
            label="취득가액(선택)"
            hint="취득가액에 취득세·중개수수료 등을 더해 넣어 주세요. 매각안 계산에 필요해요."
          />
          {asset.kind === "house" && (
            <TextField name={`assets.${index}.residedYears`} label="거주 기간(년)" numeric hint="부모님이 실제로 사신 기간" />
          )}
        </div>
      )}
      {asset.kind === "house" && (
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <CheckField name={`assets.${index}.over85`} label="전용 85㎡ 초과" />
          <CheckField name={`assets.${index}.regulatedAtAcquisition`} label="취득 당시 조정대상지역" />
          <CheckField
            name={`assets.${index}.parentsLiveHere`}
            label="부모님이 사시는 집"
            hint="부모님이 사시는 집은 지금 증여·매각하지 않고 상속으로만 계산해요."
          />
        </div>
      )}
      {asset.kind === "land" && <CheckField name={`assets.${index}.nonBusinessLand`} label="비사업용 토지" />}
    </fieldset>
  );
}

export function AssetsSection() {
  const { control } = useFormContext<SuccessionForm>();
  const { fields, append, remove } = useFieldArray({ control, name: "assets" });
  const error = useFieldError("assets");
  return (
    <Section
      title="2. 부모님 재산"
      description="현금·예금, 주택, 토지를 넣어 주세요. 공동명의 재산도 명의자 재산으로 합쳐 넣어요."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => append(emptyAsset("house"))} disabled={fields.length >= MAX_ASSETS}>
          <Plus aria-hidden="true" />
          재산 추가
        </Button>
      }
    >
      <div className="grid min-w-0 gap-4">
        {fields.map((field, index) => (
          <AssetCard key={field.id} index={index} onRemove={() => remove(index)} removable={fields.length > 1} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">최대 {MAX_ASSETS}개까지 넣을 수 있어요.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Section>
  );
}
