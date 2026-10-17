"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage, isApiError } from "@/lib/api-client";
import { useConnectionActions } from "../hooks";

const schema = z.object({
  provider: z.enum(["kiwoom", "toss", "mock"]),
  environment: z.enum(["mock", "real"]),
  label: z.string().trim().min(1, "별칭을 입력해 주세요.").max(30, "30자까지 입력해 주세요."),
  appKey: z.string().min(1, "앱키를 입력해 주세요.").max(200, "200자까지 입력해 주세요."),
  appSecret: z.string().min(1, "시크릿을 입력해 주세요.").max(200, "200자까지 입력해 주세요."),
  accountNo: z.string().max(200, "200자까지 입력해 주세요."),
});
type FormValues = z.infer<typeof schema>;

export function ConnectionForm({ allowMock, onSaved }: { allowMock: boolean; onSaved: () => void }) {
  const { create } = useConnectionActions();
  const { register, control, setValue, handleSubmit, setError, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema), defaultValues: { provider: "kiwoom", environment: "mock", label: "", appKey: "", appSecret: "", accountNo: "" },
  });
  const provider = useWatch({ control, name: "provider" });
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
  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" autoComplete="off">
      <div className="space-y-2">
        <Label htmlFor="broker-provider">증권사</Label>
        <select id="broker-provider" className={selectClass} {...register("provider", { onChange: (event) => setValue("environment", event.target.value === "toss" ? "real" : "mock") })}>
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
      {([
        ["label", "별칭", "text", 30], ["appKey", "앱키", "password", 200],
        ["appSecret", "시크릿", "password", 200], ["accountNo", provider === "toss" ? "계좌 식별값 (accountSeq)" : "계좌번호", "password", 200],
      ] as const).map(([field, label, type, maxLength]) => (
        <div className="space-y-2" key={field}>
          <Label htmlFor={`broker-${field}`}>{label}</Label>
          <Input id={`broker-${field}`} type={type} maxLength={maxLength} {...register(field)} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `${field}-error` : undefined} />
          {errors[field] && <p id={`${field}-error`} role="alert" className="text-sm text-destructive">{errors[field]?.message}</p>}
        </div>
      ))}
      {provider === "mock" && <p className="text-sm text-muted-foreground">앱키와 시크릿에 임의의 문자열을 입력하세요. 가상 계좌를 연결합니다.</p>}
      {provider === "toss" && <p className="text-sm text-muted-foreground">토스 계좌 조회에 필요한 accountSeq를 입력하세요. 일반 계좌번호와 다릅니다.</p>}
      {create.error && <p role="alert" className="text-sm text-destructive">{getErrorMessage(create.error)}</p>}
      <Button type="submit" disabled={create.isPending} className="w-full">{create.isPending ? "저장 중…" : "연결 저장"}</Button>
    </form>
  );
}
