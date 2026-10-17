"use client";

import { useId, type ReactNode } from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import { formatKRW, formatKRWCompact } from "@/lib/format";
import { excludedAssumptions } from "../utils";
import type { TaxResult } from "../types";

export type Values = Record<string, string | boolean>;
export interface Field {
  name: string; label: string; type?: "text" | "number" | "date" | "checkbox" | "range" | "textarea";
  options?: { value: string; label: string }[];
  min?: number; max?: number; step?: number; required?: boolean; money?: boolean; hint?: string; disabled?: boolean;
}
export function options(labels: Record<string, string>) { return Object.entries(labels).map(([value, label]) => ({ value, label })); }
export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6">{title && <h2 className="text-lg font-semibold">{title}</h2>}{children}</section>;
}
export function Assumptions({ items = [] }: { items?: string[] }) {
  return <details className="rounded-lg border p-4 text-sm"><summary className="cursor-pointer font-medium">계산 가정</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">{[...new Set([...excludedAssumptions, ...items])].map((item) => <li key={item}>{item}</li>)}</ul></details>;
}
function FieldInput({ field, form }: { field: Field; form: UseFormReturn<Values> }) {
  const id = useId();
  const value = useWatch({ control: form.control, name: field.name });
  const error = form.formState.errors[field.name];
  const common = { id, disabled: field.disabled, "aria-invalid": Boolean(error), "aria-describedby": `${id}-help`, ...form.register(field.name) };
  return <div className="min-w-0 space-y-1.5">
    {field.type === "checkbox" ? <label className="flex items-start gap-2 py-2 text-sm" htmlFor={id}><input type="checkbox" {...common} className="mt-0.5 size-4" />{field.label}</label> : <><label className="text-sm font-medium" htmlFor={id}>{field.label}{field.required && <span className="ml-1 text-destructive">*</span>}</label>
      {field.options ? <select {...common} className="h-9 w-full min-w-0 rounded-lg border bg-background px-2 text-sm">{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === "textarea" ? <textarea {...common} className="min-h-20 w-full rounded-lg border p-2 text-sm" /> : <Input {...common} value={field.type === "range" ? String(value ?? field.min ?? 0) : undefined} type={field.type ?? "text"} min={field.min} max={field.max} step={field.step ?? 1} inputMode={field.money ? "numeric" : undefined} />}
    </>}
    <div id={`${id}-help`} className="text-xs text-muted-foreground">
      {field.money && <p>{formatKRWCompact(Number(value) || 0)} · {((Number(value) || 0) / 10000).toLocaleString("ko-KR")}만원</p>}
      {field.type === "range" && <p>{String(value)}{field.name === "horizonYears" ? `년 뒤 · ${Number(new Date().getFullYear()) + Number(value)}년 기준` : "세"}</p>}
      {field.hint && <p>{field.hint}</p>}
      {error && <p role="alert" className="text-destructive">{String(error.message)}</p>}
    </div>
  </div>;
}
export function DataForm({ fields, defaults, onSubmit, label = "계산하기", pending = false, children, actions }: {
  fields: Field[] | ((values: Values) => Field[]); defaults: Values; onSubmit: (values: Values) => Promise<unknown>;
  label?: string; pending?: boolean; children?: ReactNode; actions?: (form: UseFormReturn<Values>) => ReactNode;
}) {
  const form = useForm<Values>({ defaultValues: defaults });
  const values = useWatch({ control: form.control }) as Values;
  const current = typeof fields === "function" ? fields(values) : fields;
  async function submit(data: Values) {
    form.clearErrors();
    let valid = true;
    for (const field of current.filter((f) => !f.disabled)) {
      let schema: z.ZodType = field.type === "checkbox" ? z.boolean() : z.string();
      if (field.type === "number" || field.type === "range") {
        schema = z.coerce.number().finite().min(field.min ?? 0).max(field.max ?? 1e12);
        if (field.step === undefined || field.step === 1) schema = (schema as z.ZodNumber).int();
      } else if (field.required) schema = z.string().min(1, "필수 항목입니다.");
      const result = schema.safeParse(data[field.name]);
      if (!result.success) { form.setError(field.name, { message: "입력값과 허용 범위를 확인해 주세요." }); valid = false; }
    }
    if (!valid) return;
    try { await onSubmit(data); }
    catch (error) {
      if (error instanceof ApiError) error.details.forEach((detail) => form.setError(detail.field, { message: detail.message }));
      form.setError("root", { message: getErrorMessage(error) });
    }
  }
  return <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
    {actions?.(form)}
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">{current.map((field) => <FieldInput key={field.name} field={field} form={form} />)}</div>
    {children}
    {form.formState.errors.root && <p role="alert" className="text-sm text-destructive">{form.formState.errors.root.message}</p>}
    <Button type="submit" disabled={pending || form.formState.isSubmitting}>{pending || form.formState.isSubmitting ? "처리 중…" : label}</Button>
  </form>;
}
export function TaxSteps({ result }: { result: TaxResult }) {
  return <Panel title="참고용 계산 결과"><div className="rounded-lg bg-primary/5 p-4"><p className="text-sm text-muted-foreground">예상 납부세액</p><p className="mt-1 break-all text-2xl font-bold tabular-nums">{formatKRW(result.payableTax)}</p></div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">세금 계산 단계</caption><thead><tr className="border-b"><th className="p-2">계산 단계</th><th className="p-2">금액</th><th className="p-2">근거</th></tr></thead><tbody>{result.steps.map((step) => <tr key={step.key} className="border-b align-top"><th className="p-2 font-medium">{step.label}</th><td className="p-2 tabular-nums">{formatKRW(step.amount)}</td><td className="p-2 text-muted-foreground">{step.note}</td></tr>)}</tbody></table></div>
    {result.notes.map((note) => <p key={note} className="text-sm text-muted-foreground">{note}</p>)}<Assumptions items={result.assumptions} /></Panel>;
}
export const moneyField = (name: string, label: string, min = 0): Field => ({ name, label, type: "number", money: true, min, max: 1e12, required: true });
