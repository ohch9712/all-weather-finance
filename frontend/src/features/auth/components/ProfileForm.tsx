"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { currentKstYear } from "@/lib/format";
import { useUpdateProfile } from "../hooks";
import type { Profile } from "../types";
import {
  createProfileSchema,
  getBirthYearOptions,
  type ProfileFormInput,
  type ProfileFormOutput,
} from "../validation";
import { FormAlert } from "./FormAlert";

const FIELDS = ["birthYear", "nickname"] as const;

interface ProfileFormProps {
  defaultValues?: { birthYear: number | null; nickname: string | null };
  submitLabel: string;
  /** 저장에 성공하면 서버가 돌려준 프로필로 부른다. 여기서 던진 에러는 폼 위에 보여 준다. */
  onSaved: (profile: Profile) => void | Promise<void>;
}

/** 출생연도(필수)·닉네임(선택) 입력 폼. 온보딩과 프로필 설정이 함께 쓴다. `PUT /api/profile` */
export function ProfileForm({ defaultValues, submitLabel, onSaved }: ProfileFormProps) {
  const currentYear = currentKstYear();
  const schema = useMemo(() => createProfileSchema(currentYear), [currentYear]);
  const years = useMemo(() => getBirthYearOptions(currentYear), [currentYear]);
  const updateProfile = useUpdateProfile();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ProfileFormInput, unknown, ProfileFormOutput>({
    resolver: zodResolver(schema),
    defaultValues: {
      birthYear: defaultValues?.birthYear ? String(defaultValues.birthYear) : "",
      nickname: defaultValues?.nickname ?? "",
    },
  });

  async function onSubmit(values: ProfileFormOutput) {
    setFormError(null);
    try {
      const profile = await updateProfile.mutateAsync(values);
      await onSaved(profile);
    } catch (error) {
      const result = toSubmitErrors(error, FIELDS);
      applyFieldErrors(form.setError, result.fieldErrors);
      setFormError(result.formError);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-5">
        <FormAlert message={formError} />
        <FormField
          control={form.control}
          name="birthYear"
          render={({ field }) => (
            <FormItem>
              <FormLabel>출생연도</FormLabel>
              <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full sm:w-60">
                    <SelectValue placeholder="출생연도 선택" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="max-h-72">
                  {years.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}년
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="nickname"
          render={({ field }) => (
            <FormItem>
              <FormLabel>닉네임</FormLabel>
              <FormControl>
                <Input autoComplete="nickname" placeholder="선택 입력" className="sm:w-80" {...field} />
              </FormControl>
              <FormDescription>선택 항목이에요. 20자까지 쓸 수 있어요.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="lg" disabled={form.formState.isSubmitting} className="w-full sm:w-auto">
          {form.formState.isSubmitting ? "저장 중…" : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
