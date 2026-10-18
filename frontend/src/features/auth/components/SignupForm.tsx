"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { useAuth } from "../AuthProvider";
import { useRedirectIfAuthenticated, useSignup } from "../hooks";
import { signupSchema, type SignupValues } from "../validation";
import { FormAlert } from "./FormAlert";
import { ONBOARDING_PATH } from "./OnboardingGate";

const FIELDS = ["email", "password", "passwordConfirm"] as const;

export function SignupForm() {
  const router = useRouter();
  const { setAuth } = useAuth();
  const signupMutation = useSignup();
  const [formError, setFormError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  useRedirectIfAuthenticated(completed);

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", passwordConfirm: "", ageConfirmed: false },
  });

  async function onSubmit({ email, password, passwordConfirm }: SignupValues) {
    setFormError(null);
    try {
      // 만 14세 확인 값은 서버로 보내지 않는다(서버는 출생연도로 검사한다).
      const payload = await signupMutation.mutateAsync({ email, password, passwordConfirm });
      setCompleted(true);
      setAuth(payload);
      router.push(ONBOARDING_PATH);
    } catch (error) {
      const result = toSubmitErrors(error, FIELDS, { codeToField: { EMAIL_ALREADY_EXISTS: "email" } });
      applyFieldErrors(form.setError, result.fieldErrors);
      setFormError(result.formError);
    }
  }

  const submitting = form.formState.isSubmitting || completed;
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
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
          rules={{ deps: ["passwordConfirm"] }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>비밀번호</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>8~128자로 입력해 주세요.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="passwordConfirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>비밀번호 확인</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="ageConfirmed"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    ref={field.ref}
                    name={field.name}
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    onBlur={field.onBlur}
                  />
                </FormControl>
                <FormLabel className="font-normal">만 14세 이상입니다.</FormLabel>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <p className="text-xs leading-5 text-muted-foreground break-keep">
          가입하면{" "}
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4"
          >
            개인정보 처리방침
          </Link>
          에 따라 개인정보가 처리됩니다.
        </p>
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "가입 중…" : "가입하기"}
        </Button>
      </form>
    </Form>
  );
}
