"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
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
