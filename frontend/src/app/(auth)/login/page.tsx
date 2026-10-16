import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { LoadingState } from "@/components/common/LoadingState";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/LoginForm";

export const metadata: Metadata = { title: "로그인" };

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg">로그인</h1>
        </CardTitle>
        <CardDescription>이메일과 비밀번호로 로그인하세요.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* LoginForm은 ?next=를 읽으므로 Suspense 안에 둔다(useSearchParams). */}
        <Suspense fallback={<LoadingState rows={2} />}>
          <LoginForm />
        </Suspense>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        계정이 없나요?&nbsp;
        <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
          가입하기
        </Link>
      </CardFooter>
    </Card>
  );
}
