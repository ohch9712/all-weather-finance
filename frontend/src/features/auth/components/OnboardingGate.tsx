"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../AuthProvider";
import { AuthGateFallback } from "./AuthGateFallback";

export const ONBOARDING_PATH = "/onboarding";

/** 출생연도를 아직 입력하지 않은 사용자는 `/onboarding`으로 보낸다. RequireAuth 안에서 쓴다. */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { status, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const needsOnboarding = status === "authenticated" && profile?.birthYear == null && pathname !== ONBOARDING_PATH;

  useEffect(() => {
    if (needsOnboarding) router.replace(ONBOARDING_PATH);
  }, [needsOnboarding, router]);

  if (needsOnboarding) return <AuthGateFallback label="기본 정보 입력 화면으로 이동하고 있어요" />;
  return <>{children}</>;
}
