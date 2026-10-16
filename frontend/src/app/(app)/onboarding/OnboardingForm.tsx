"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/features/auth/AuthProvider";
import { ProfileForm } from "@/features/auth/components/ProfileForm";

// 저장 후 02의 투자성향 설문으로 이어진다(스펙 01 12.3, 02 9절).
export const ONBOARDING_NEXT_PATH = "/allocation/survey?onboarding=1";

export function OnboardingForm() {
  const router = useRouter();
  const { profile, refresh } = useAuth();

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="기본 정보 입력"
        description="나이대와 투자성향, 목표에 따라 권장 자산배분이 달라져요. 먼저 출생연도를 알려 주세요."
      />
      <Card>
        <CardContent>
          <ProfileForm
            defaultValues={{ birthYear: profile?.birthYear ?? null, nickname: profile?.nickname ?? null }}
            submitLabel="저장하고 계속하기"
            onSaved={async () => {
              await refresh();
              router.push(ONBOARDING_NEXT_PATH);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
