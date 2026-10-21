"use client";

import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { emptyChild, emptyGift, MAX_CHILDREN, MAX_GIFTS, type SuccessionForm } from "../form";
import { DONOR_LABELS } from "../utils";
import { CheckField, MoneyField, Section, SelectField, TextField, useFieldError } from "./fields";

const DONOR_OPTIONS = Object.entries(DONOR_LABELS).map(([value, label]) => ({ value, label }));

function PastGifts({ childIndex, childName }: { childIndex: number; childName: string }) {
  const { control } = useFormContext<SuccessionForm>();
  const { fields, append, remove } = useFieldArray({ control, name: `children.${childIndex}.pastGifts` });
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">과거에 증여받은 내역</p>
        <Button type="button" variant="outline" size="sm" onClick={() => append(emptyGift())} disabled={fields.length >= MAX_GIFTS}>
          <Plus aria-hidden="true" />
          증여 내역 추가
        </Button>
      </div>
      {fields.length === 0 && <p className="text-xs text-muted-foreground">없으면 비워 두세요. 10년 안의 증여는 공제와 세금 계산에 더해져요.</p>}
      {fields.map((field, index) => (
        <div key={field.id} className="grid min-w-0 gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]" role="group" aria-label={`${childName} 증여 ${index + 1}`}>
          <TextField name={`children.${childIndex}.pastGifts.${index}.giftedOn`} label="증여일" type="date" required />
          <SelectField name={`children.${childIndex}.pastGifts.${index}.donorGroup`} label="준 사람" options={DONOR_OPTIONS} />
          <MoneyField name={`children.${childIndex}.pastGifts.${index}.amount`} label="금액" required />
          <MoneyField name={`children.${childIndex}.pastGifts.${index}.taxPaid`} label="낸 증여세" />
          <div className="flex items-start lg:pt-6">
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)} aria-label={`증여 내역 삭제 ${index + 1}`}>
              <Trash2 aria-hidden="true" />
              삭제
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChildCard({ index, onRemove, removable }: { index: number; onRemove: () => void; removable: boolean }) {
  const { getValues, setValue } = useFormContext<SuccessionForm>();
  const child = useWatch<SuccessionForm, `children.${number}`>({ name: `children.${index}` });
  const name = child.displayName.trim() || `자녀 ${index + 1}`;
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border p-4" aria-label={name}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-base font-semibold">{name}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={!removable} aria-label={`삭제 ${name}`}>
          <Trash2 aria-hidden="true" />
          삭제
        </Button>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <TextField name={`children.${index}.displayName`} label="이름" required hint="실명 대신 별칭을 권해요." />
        <TextField name={`children.${index}.age`} label="나이(만)" numeric required hint="19~90세" />
        <TextField name={`children.${index}.houseCount`} label="세대 주택 수" numeric hint="본인 세대가 가진 주택 수" />
      </div>
      <CheckField
        name={`children.${index}.isSelf`}
        label="본인"
        onChange={(checked) => {
          if (!checked) return;
          getValues("children").forEach((_, other) => {
            if (other !== index) setValue(`children.${other}.isSelf`, false, { shouldDirty: true });
          });
        }}
      />
      <PastGifts childIndex={index} childName={name} />
    </fieldset>
  );
}

export function ChildrenSection() {
  const { control } = useFormContext<SuccessionForm>();
  const { fields, append, remove } = useFieldArray({ control, name: "children" });
  const error = useFieldError("children");
  return (
    <Section
      title="3. 나와 형제자매"
      description="상속·증여를 받을 자녀를 모두 넣어 주세요(성년만, 최대 10명)."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => append(emptyChild())} disabled={fields.length >= MAX_CHILDREN}>
          <Plus aria-hidden="true" />
          형제자매 추가
        </Button>
      }
    >
      <div className="grid min-w-0 gap-4">
        {fields.map((field, index) => (
          <ChildCard key={field.id} index={index} onRemove={() => remove(index)} removable={fields.length > 1} />
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Section>
  );
}
