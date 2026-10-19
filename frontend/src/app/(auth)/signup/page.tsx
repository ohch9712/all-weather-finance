import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupForm } from "@/features/auth/components/SignupForm";

export const metadata: Metadata = { title: "가입" };

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg">가입하기</h1>
        </CardTitle>
        <CardDescription>가입 시 바로 로그인되고, 출생연도를 입력하는 화면으로 이어져요.</CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        이미 계정이 있나요?&nbsp;
        <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          로그인
        </Link>
      </CardFooter>
    </Card>
  );
}
