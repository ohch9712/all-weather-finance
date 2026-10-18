"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronRight, CircleAlert, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { useAuth } from "../AuthProvider";
import { deleteAccountSchema, type DeleteAccountValues } from "../validation";

// 계정 삭제 안내(스펙 19 5.3). 문구를 바꾸지 않는다.
export const DELETE_ACCOUNT_NOTES = [
  "계정을 삭제하면 자산·가계부·매매일지·가족·증여 기록·관심종목·조건검색·챗봇 대화·연결 정보가 모두 지워지고 되돌릴 수 없습니다.",
  "CODEF 연결이 있으면 CODEF에 등록된 로그인 정보부터 지웁니다. 지우지 못하면 계정 삭제를 멈춥니다.",
  "증권사 앱키는 이 앱에서 지워도 증권사에는 발급된 상태로 남습니다. 필요하면 증권사 포털에서 해지해 주세요.",
  "서버 백업에는 최대 7일 동안 남았다가 지워집니다.",
] as const;

const CONNECTIONS_PATH = "/settings/connections";

interface SubmitError {
  message: string;
  /** CODEF 연결을 지우지 못한 409면 데이터 자동 수집 화면 링크를 함께 보여 준다. */
  showConnectionsLink: boolean;
}

function isCodefConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.message.includes("CODEF");
}

/** 위험 영역: 비밀번호 확인 → 확인 창 → `DELETE /api/auth/me`. 성공하면 AuthProvider가 `/login?deleted=1`로 보낸다. */
export function DeleteAccountCard() {
  const { deleteAccount } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const form = useForm<DeleteAccountValues>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { password: "" },
  });

  async function handleConfirm() {
    setSubmitError(null);
    try {
      await deleteAccount(form.getValues("password"));
    } catch (error) {
      // 실패하면 비밀번호 칸을 비운다. 확인 창은 닫히고 이유는 카드 안에 보여 준다.
      form.setValue("password", "");
      const result = toSubmitErrors(error, ["password"] as const);
      applyFieldErrors(form.setError, result.fieldErrors);
      setSubmitError(
        result.formError ? { message: result.formError, showConnectionsLink: isCodefConflict(error) } : null,
      );
    }
  }

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle>
          <h2 className="text-destructive">계정 삭제</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground break-keep">
          {DELETE_ACCOUNT_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(() => {
              setSubmitError(null);
              setConfirmOpen(true);
            })}
            noValidate
            className="space-y-4"
          >
            {submitError && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertDescription className="space-y-2">
                  <p>{submitError.message}</p>
                  {submitError.showConnectionsLink && (
                    <Link
                      href={CONNECTIONS_PATH}
                      className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
                    >
                      데이터 자동 수집으로 이동
                      <ChevronRight aria-hidden="true" className="size-4" />
                    </Link>
                  )}
                </AlertDescription>
              </Alert>
            )}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>비밀번호</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" className="sm:w-80" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" variant="destructive">
              <Trash2 aria-hidden="true" />
              계정 삭제
            </Button>
          </form>
        </Form>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="정말 계정을 삭제할까요?"
          description="이 작업은 되돌릴 수 없습니다."
          confirmLabel="계정 삭제"
          destructive
          onConfirm={handleConfirm}
        />
      </CardContent>
    </Card>
  );
}
