"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, LogOut } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/features/auth/AuthProvider";
import { ProfileForm } from "@/features/auth/components/ProfileForm";
import { getErrorMessage } from "@/lib/api-client";

export function ProfileSettings() {
  const { user, profile, refresh, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } catch (error) {
      toast.error(getErrorMessage(error));
      setLoggingOut(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="프로필 설정" description="출생연도로 나이대를 계산해 권장 자산배분에 반영해요." />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>기본 정보</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="account-email">이메일</Label>
            <Input id="account-email" type="email" value={user?.email ?? ""} readOnly disabled className="sm:w-80" />
          </div>
          <ProfileForm
            defaultValues={{ birthYear: profile?.birthYear ?? null, nickname: profile?.nickname ?? null }}
            submitLabel="저장"
            onSaved={async () => {
              toast.success("프로필을 저장했어요.");
              await refresh().catch(() => {
                // 저장은 끝났다. 화면 값은 다음 확인 때 맞춰진다.
              });
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>투자성향</h2>
          </CardTitle>
          <CardDescription>투자성향이 바뀌었다면 다시 진단해 권장 배분을 새로 받아 보세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/allocation/survey">
              투자성향 다시 진단하기
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>계정</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="destructive" onClick={() => void handleLogout()} disabled={loggingOut}>
            <LogOut aria-hidden="true" />
            {loggingOut ? "로그아웃 중…" : "로그아웃"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
