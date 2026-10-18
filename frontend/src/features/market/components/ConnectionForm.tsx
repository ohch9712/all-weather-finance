"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage, isApiError } from "@/lib/api-client";
import { brokerErrorMessage } from "../errors";
import { useConnectionActions, useTossAccounts } from "../hooks";
import type { TossAccount } from "../types";

const schema = z.object({
  provider: z.enum(["kiwoom", "toss", "mock"]),
  environment: z.enum(["mock", "real"]),
  label: z.string().trim().min(1, "별칭을 입력해 주세요.").max(30, "30자까지 입력해 주세요."),
  appKey: z.string().min(1, "앱키를 입력해 주세요.").max(200, "200자까지 입력해 주세요."),
  appSecret: z.string().min(1, "시크릿을 입력해 주세요.").max(200, "200자까지 입력해 주세요."),
  accountNo: z.string().max(200, "200자까지 입력해 주세요."),
}).superRefine((values, ctx) => {
  if (values.provider === "toss" && !values.accountNo) ctx.addIssue({ code: "custom", path: ["accountNo"], message: "계좌를 불러와 골라 주세요." });
});
type FormValues = z.infer<typeof schema>;

const accountLabel = (account: TossAccount) => `${account.accountType === "BROKERAGE" ? "종합매매" : account.accountType} ****${account.accountNoLast4}`;

export function ConnectionForm({ allowMock, onSaved }: { allowMock: boolean; onSaved: () => void }) {
  const { create } = useConnectionActions();
  const tossAccounts = useTossAccounts();
  const { register, control, setValue, getValues, handleSubmit, setError, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema), defaultValues: { provider: "kiwoom", environment: "mock", label: "", appKey: "", appSecret: "", accountNo: "" },
  });
  const [provider, appKey, appSecret, accountNo] = useWatch({ control, name: ["provider", "appKey", "appSecret", "accountNo"] });
  const accounts = tossAccounts.data?.items;

  // 토스 계좌 목록은 불러올 때 쓴 키에만 맞으므로 키·증권사가 바뀌면 목록과 선택을 비운다.
  function clearTossAccounts() {
    tossAccounts.reset();
    setValue("accountNo", "");
  }
  function loadTossAccounts() {
    setValue("accountNo", "");
    tossAccounts.mutate({ appKey, appSecret }, {
      onSuccess: ({ items }) => { if (items.length === 1) setValue("accountNo", items[0].accountSeq, { shouldValidate: true }); },
      onError: (error) => {
        if (isApiError(error)) error.details.forEach((detail) => {
          if (detail.field === "appKey" || detail.field === "appSecret") setError(detail.field, { message: detail.message });
        });
      },
    });
  }
  async function submit(values: FormValues) {
    try {
      await create.mutateAsync(values);
      onSaved();
    } catch (error) {
      if (isApiError(error)) error.details.forEach((detail) => {
        if (detail.field in values) setError(detail.field as keyof FormValues, { message: detail.message });
      });
    }
  }
  const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";
  const fieldError = (field: keyof FormValues) => errors[field] && <p id={`${field}-error`} role="alert" className="text-sm text-destructive">{errors[field]?.message}</p>;
  const errorProps = (field: keyof FormValues) => ({ "aria-invalid": !!errors[field], "aria-describedby": errors[field] ? `${field}-error` : undefined });
  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" autoComplete="off">
      <div className="space-y-2">
        <Label htmlFor="broker-provider">증권사</Label>
        <select id="broker-provider" className={selectClass} {...register("provider", { onChange: (event) => { setValue("environment", event.target.value === "toss" ? "real" : "mock"); clearTossAccounts(); } })}>
          <option value="kiwoom">키움증권</option><option value="toss">토스증권</option>
          {allowMock && <option value="mock">샘플 증권사</option>}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="broker-environment">환경</Label>
        <select id="broker-environment" className={selectClass} {...register("environment")}>
          {provider !== "toss" && <option value="mock">모의</option>}
          {provider !== "mock" && <option value="real">실전</option>}
        </select>
      </div>
      {([["label", "별칭", "text", 30], ["appKey", "앱키", "password", 200], ["appSecret", "시크릿", "password", 200]] as const).map(([field, label, type, maxLength]) => (
        <div className="space-y-2" key={field}>
          <Label htmlFor={`broker-${field}`}>{label}</Label>
          <Input id={`broker-${field}`} type={type} maxLength={maxLength} {...register(field, field === "label" ? undefined : { onChange: () => { if (getValues("provider") === "toss") clearTossAccounts(); } })} {...errorProps(field)} />
          {fieldError(field)}
        </div>
      ))}
      {provider === "toss" ? (
        <div className="space-y-2">
          <Button type="button" variant="outline" className="w-full" disabled={!appKey || !appSecret || tossAccounts.isPending} onClick={loadTossAccounts}>
            {tossAccounts.isPending ? "불러오는 중…" : "계좌 불러오기"}
          </Button>
          {accounts && (accounts.length ? (
            <div className="space-y-2">
              <Label htmlFor="broker-accountNo">계좌</Label>
              <select id="broker-accountNo" className={selectClass} {...register("accountNo")} {...errorProps("accountNo")}>
                {accounts.length > 1 && <option value="">계좌를 고르세요</option>}
                {accounts.map((account) => <option key={account.accountSeq} value={account.accountSeq}>{accountLabel(account)}</option>)}
              </select>
            </div>
          ) : <p role="status" className="text-sm text-muted-foreground">토스증권 종합매매 계좌가 없습니다.</p>)}
          {tossAccounts.error && <p role="alert" className="text-sm text-destructive">{brokerErrorMessage(tossAccounts.error)}</p>}
          {fieldError("accountNo")}
          <p className="text-sm text-muted-foreground">앱키와 시크릿을 입력한 뒤 ‘계좌 불러오기’로 연결할 계좌를 고르세요.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="broker-accountNo">계좌번호</Label>
          <Input id="broker-accountNo" type="password" maxLength={200} {...register("accountNo")} {...errorProps("accountNo")} />
          {fieldError("accountNo")}
        </div>
      )}
      {provider === "mock" && <p className="text-sm text-muted-foreground">앱키와 시크릿에 임의의 문자열을 입력하세요. 가상 계좌를 연결합니다.</p>}
      {create.error && <p role="alert" className="text-sm text-destructive">{getErrorMessage(create.error)}</p>}
      <Button type="submit" disabled={create.isPending || (provider === "toss" && !accountNo)} className="w-full">{create.isPending ? "저장 중…" : "연결 저장"}</Button>
    </form>
  );
}
