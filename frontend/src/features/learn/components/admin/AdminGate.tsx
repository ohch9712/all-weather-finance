"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { LoadingState } from "@/components/common/LoadingState";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";

/** 관리자 화면 보호. 일반 사용자는 "권한이 없습니다" 화면을 보고 관리자 API를 부르지 않는다(서버도 403으로 막는다). */
export function AdminGate({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  if (status === "loading") return <LoadingState />;
  if (user?.role !== "admin") {
    return (
      <div role="alert" className="flex flex-col items-center justify-center gap-3 rounded-xl border px-4 py-12 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">권한이 없습니다</h1>
          <p className="text-sm text-muted-foreground break-keep">관리자만 볼 수 있는 화면이에요.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/learn">학습 목록으로</Link>
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
