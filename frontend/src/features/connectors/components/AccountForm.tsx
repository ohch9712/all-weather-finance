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
  consent: z.boolean().refine(Boolean, "안내 내용을 확인하고 동의해 주세요."),
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
    <aside aria-labelledby="login-info-heading" className="space-y-2 rounded-lg bg-muted p-3 text-sm leading-relaxed">
      <h3 id="login-info-heading" className="font-medium">로그인 정보 처리 방식</h3>
      <ol className="list-decimal space-y-2 break-words pl-5">
        <li>이 앱은 아이디·비밀번호를 저장하지 않습니다. 비밀번호는 암호화해 CODEF로 보냅니다.</li>
        <li>로그인 정보는 CODEF에 등록되고, CODEF는 이를 AES-256 등으로 암호화해 보관합니다. 연결할 때와 &apos;가져오기&apos;를 누를 때만 이 정보로 금융사에 로그인합니다.</li>
        <li>이 앱은 카드 승인내역과 계좌 잔액 조회만 요청합니다. 결제·이체 기능은 없습니다.</li>
        <li>연결을 삭제하면 CODEF에 등록된 로그인 정보도 즉시 삭제됩니다. 금융사 비밀번호를 바꿔도 등록된 정보로는 더 이상 로그인할 수 없습니다.</li>
        <li>CODEF는 서비스 품질 관리와 문의 대응을 위해 조회 요청·응답 기록을 보관합니다. 이 기록은 연결을 삭제해도 남으며, 이 앱과 CODEF의 이용 계약이 끝나면 일괄 삭제됩니다.</li>
      </ol>
      <a className="inline-block underline underline-offset-4" href="https://codef.io/legal/security" target="_blank" rel="noopener noreferrer">CODEF 보안 정책 보기</a>
    </aside>
    {kind === "bank" && <p className="text-sm text-muted-foreground">은행은 기관에 따라 아이디 로그인이 막힐 수 있어요.</p>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 shrink-0" {...register("consent")} aria-invalid={!!errors.consent} /><span>위 내용을 확인했고, 금융사 로그인 정보를 CODEF에 등록하는 데 동의합니다.</span></label>
    {errors.consent && <p role="alert" className="text-sm text-destructive">{errors.consent.message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" className="w-full" disabled={create.isPending}>{create.isPending ? "연결 중…" : "계정 연결"}</Button>
  </form>;
}
