"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ErrorState } from "@/components/common/ErrorState";
import { useAuth } from "../AuthProvider";
import { getLoginPath } from "../redirect";
import { AuthGateFallback } from "./AuthGateFallback";

/**
 * 로그인한 사용자만 children을 본다.
 * - 확인 중: 전체 화면 Skeleton
 * - 미인증: `/login?next=<현재 경로>`로 이동(이 화면에서 로그아웃한 경우는 logout이 `/login`으로 보낸다)
 * - 확인 실패(백엔드 꺼짐·5xx): 오류 상태와 다시 시도
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, error, signedOut, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const shouldRedirect = status === "unauthenticated" && !error && !signedOut;

  useEffect(() => {
    if (shouldRedirect) router.replace(getLoginPath(search ? `${pathname}?${search}` : pathname));
  }, [shouldRedirect, pathname, search, router]);

  if (status === "authenticated") return <>{children}</>;

  if (status === "unauthenticated" && error) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
        <div className="w-full">
          <ErrorState error={error} onRetry={() => void refresh().catch(() => {})} />
        </div>
      </div>
    );
  }

  return <AuthGateFallback />;
}
