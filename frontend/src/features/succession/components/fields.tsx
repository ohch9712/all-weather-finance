"use client";

import { useId, type ReactNode } from "react";
import { Controller, get, useFormContext, type Path } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseInteger, type SuccessionForm } from "../form";
import { moneyHint } from "../utils";

type Name = Path<SuccessionForm>;

export function useFieldError(name: string): string | undefined {
  const {
    formState: { errors },
  } = useFormContext<SuccessionForm>();
  return get(errors, name)?.message as string | undefined;
}

interface FieldShellProps {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function FieldShell({ id, label, error, hint, required, className, children }: FieldShellProps) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium break-keep">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </label>
      {children}
      <div id={`${id}-help`} className="space-y-0.5 text-xs text-muted-foreground break-keep">
        {hint}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

interface TextFieldProps {
  name: Name;
  label: string;
  type?: "text" | "date";
  numeric?: boolean;
  decimal?: boolean;
  hint?: ReactNode;
  required?: boolean;
  placeholder?: string;
  className?: string;
}

export function TextField({ name, label, type = "text", numeric, decimal, hint, required, placeholder, className }: TextFieldProps) {
  const id = useId();
  const { register } = useFormContext<SuccessionForm>();
  const error = useFieldError(name);
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <Input
        id={id}
        type={type}
        inputMode={decimal ? "decimal" : numeric ? "numeric" : undefined}
        autoComplete="off"
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help`}
        {...register(name)}
      />
    </FieldShell>
  );
}

/** 원 단위 금액. 숫자만 받고 쉼표로 묶어 보여 주며 "1.2억원 · 12,000만원" 도우미를 붙인다. */
export function MoneyField({ name, label, hint, required, className }: Omit<TextFieldProps, "type" | "numeric" | "decimal">) {
  const id = useId();
  const { control } = useFormContext<SuccessionForm>();
  const error = useFieldError(name);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const amount = parseInteger(String(field.value ?? ""));
        return (
          <FieldShell
            id={id}
            label={label}
            error={error}
            required={required}
            className={className}
            hint={
              <>
                <span className="block tabular-nums" aria-live="polite">
                  {amount === null ? "원 단위로 입력해 주세요." : moneyHint(amount)}
                </span>
                {hint}
              </>
            }
          >
            <div className="relative">
              <Input
                id={id}
                ref={field.ref}
                name={field.name}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className="pr-7 text-right tabular-nums"
                aria-invalid={Boolean(error)}
                aria-describedby={`${id}-help`}
                value={amount === null ? String(field.value ?? "") : amount.toLocaleString("ko-KR")}
                onBlur={field.onBlur}
                onChange={(event) => field.onChange(event.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, ""))}
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">원</span>
            </div>
          </FieldShell>
        );
      }}
    />
  );
}

export function CheckField({ name, label, hint, onChange }: { name: Name; label: ReactNode; hint?: ReactNode; onChange?: (checked: boolean) => void }) {
  const id = useId();
  const { register } = useFormContext<SuccessionForm>();
  const registration = register(name);
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="flex items-start gap-2 text-sm break-keep">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          {...registration}
          onChange={(event) => {
            void registration.onChange(event);
            onChange?.(event.target.checked);
          }}
        />
        <span>{label}</span>
      </label>
      {hint && <p className="pl-6 text-xs text-muted-foreground break-keep">{hint}</p>}
    </div>
  );
}

export function SelectField({
  name,
  label,
  options,
  hint,
  onChange,
  className,
}: {
  name: Name;
  label: string;
  options: readonly { value: string; label: string }[];
  hint?: ReactNode;
  onChange?: (value: string) => void;
  className?: string;
}) {
  const id = useId();
  const { register } = useFormContext<SuccessionForm>();
  const error = useFieldError(name);
  const registration = register(name);
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} className={className}>
      <select
        id={id}
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm"
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help`}
        {...registration}
        onChange={(event) => {
          void registration.onChange(event);
          onChange?.(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function Section({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6" aria-label={title}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold break-keep">{title}</h2>
          {description && <p className="text-sm text-muted-foreground break-keep">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
