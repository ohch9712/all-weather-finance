"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
    defaultValues: { email: "", password: "", passwordConfirm: "" },
  });

  async function onSubmit(values: SignupValues) {
    setFormError(null);
    try {
      const payload = await signupMutation.mutateAsync(values);
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
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "가입 중…" : "가입하기"}
        </Button>
      </form>
    </Form>
  );
}
