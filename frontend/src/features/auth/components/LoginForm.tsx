"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { useAuth } from "../AuthProvider";
import { useLogin, useRedirectIfAuthenticated } from "../hooks";
import { getSafeRedirectPath } from "../redirect";
import { loginSchema, type LoginValues } from "../validation";
import { FormAlert } from "./FormAlert";

const FIELDS = ["email", "password"] as const;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuth();
  const loginMutation = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  useRedirectIfAuthenticated(completed);
  // 계정 삭제 뒤(`/login?deleted=1`) 한 번만 안내한다. 주소에서 deleted를 지워 새로 고치면 다시 보이지 않는다.
  const [accountDeleted] = useState(() => searchParams.get("deleted") === "1");
  useEffect(() => {
    if (!accountDeleted) return;
    const rest = new URLSearchParams(searchParams.toString());
    if (!rest.has("deleted")) return;
    rest.delete("deleted");
    const query = rest.toString();
    router.replace(query ? `/login?${query}` : "/login");
  }, [accountDeleted, searchParams, router]);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    try {
      const payload = await loginMutation.mutateAsync(values);
      setCompleted(true);
      setAuth(payload);
      router.push(getSafeRedirectPath(searchParams.get("next")));
    } catch (error) {
      const result = toSubmitErrors(error, FIELDS);
      applyFieldErrors(form.setError, result.fieldErrors);
      setFormError(result.formError);
    }
  }

  const submitting = form.formState.isSubmitting || completed;
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        {accountDeleted && !formError && (
          <Alert role="status">
            <CircleCheck aria-hidden="true" />
            <AlertDescription>계정을 삭제했습니다.</AlertDescription>
          </Alert>
        )}
        <FormAlert message={formError} />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>이메일</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" inputMode="email" placeholder="potato@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>비밀번호</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "로그인 중…" : "로그인"}
        </Button>
      </form>
    </Form>
  );
}
