"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage, isApiError } from "@/lib/api-client";
import { useConnectorActions, useConnectorOrganizations } from "../hooks";

const schema = z.object({
  kind: z.enum(["card", "bank"]),
  organization: z.string().min(1, "기관을 선택해 주세요."),
  label: z.string().trim().min(1, "별칭을 입력해 주세요.").max(30, "30자까지 입력해 주세요."),
  loginId: z.string().min(1, "아이디를 입력해 주세요.").max(200, "200자까지 입력해 주세요."),
  password: z.string().min(1, "비밀번호를 입력해 주세요.").max(200, "200자까지 입력해 주세요."),
  consent: z.boolean().refine(Boolean, "로그인 정보 전송에 동의해 주세요."),
});
type Values = z.infer<typeof schema>;
export const selectClass = "h-9 min-w-0 w-full rounded-md border bg-background px-3 text-sm";
export function AccountForm({ onSaved }: { onSaved: () => void }) {
  const { create } = useConnectorActions();
  const [error, setErrorText] = useState<string | null>(null);
  const { register, control, setValue, setError, handleSubmit, formState: { errors } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { kind: "card", organization: "", label: "", loginId: "", password: "", consent: false } });
  const kind = useWatch({ control, name: "kind" });
  const organizations = useConnectorOrganizations(kind);
  async function submit(values: Values) {
    setErrorText(null);
    try {
      await create.mutateAsync({ provider: "codef", ...values });
      onSaved();
    } catch (cause) {
      setErrorText(getErrorMessage(cause));
      if (isApiError(cause)) cause.details.forEach(detail => {
        if (detail.field in values) setError(detail.field as keyof Values, { message: detail.message });
      });
    } finally {
      setValue("loginId", "");
      setValue("password", "");
      create.reset();
    }
  }
  return <form autoComplete="off" onSubmit={handleSubmit(submit)} className="min-w-0 space-y-4">
    <div className="space-y-2"><Label htmlFor="connector-kind">종류</Label><select id="connector-kind" className={selectClass} {...register("kind", { onChange: () => setValue("organization", "") })}><option value="card">카드</option><option value="bank">은행</option></select></div>
    <div className="space-y-2"><Label htmlFor="connector-organization">기관</Label><select id="connector-organization" className={selectClass} disabled={organizations.isPending || !!organizations.error} {...register("organization")} aria-invalid={!!errors.organization}><option value="">기관 선택</option>{organizations.data?.items.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>{errors.organization && <p role="alert" className="text-sm text-destructive">{errors.organization.message}</p>}{organizations.error && <p role="alert" className="text-sm text-destructive">{getErrorMessage(organizations.error)} <button type="button" className="underline" onClick={() => void organizations.refetch()}>다시 시도</button></p>}</div>
    {([ ["label", "별칭", "text", 30], ["loginId", "로그인 아이디", "text", 200], ["password", "로그인 비밀번호", "password", 200] ] as const).map(([field, label, type, maxLength]) => <div key={field} className="space-y-2"><Label htmlFor={`connector-${field}`}>{label}</Label><Input id={`connector-${field}`} type={type} maxLength={maxLength} autoComplete={field === "password" ? "new-password" : "off"} {...register(field)} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `connector-${field}-error` : undefined} />{errors[field] && <p id={`connector-${field}-error`} role="alert" className="text-sm text-destructive">{errors[field]?.message}</p>}</div>)}
    <p className="rounded-lg bg-muted p-3 text-sm leading-relaxed">입력한 로그인 정보는 저장하지 않고 CODEF로 한 번만 전송합니다. CODEF는 이 정보로 금융사에 로그인해 데이터를 가져옵니다.</p>
    {kind === "bank" && <p className="text-sm text-muted-foreground">은행은 기관에 따라 아이디 로그인이 막힐 수 있어요.</p>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 shrink-0" {...register("consent")} aria-invalid={!!errors.consent} /><span>금융사 로그인 정보를 CODEF로 전송하는 데 동의합니다.</span></label>
    {errors.consent && <p role="alert" className="text-sm text-destructive">{errors.consent.message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" className="w-full" disabled={create.isPending}>{create.isPending ? "연결 중…" : "계정 연결"}</Button>
  </form>;
}
