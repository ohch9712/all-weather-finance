"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/features/auth/AuthProvider";
import { DeleteAccountCard } from "@/features/auth/components/DeleteAccountCard";

export function AccountSettings() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="계정" />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>계정 정보</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account-email">이메일</Label>
            <Input id="account-email" type="email" value={user?.email ?? ""} readOnly disabled className="sm:w-80" />
          </div>
          <Link
            href="/privacy"
            className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
          >
            개인정보 처리방침 보기
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </CardContent>
      </Card>

      <DeleteAccountCard />
    </div>
  );
}
