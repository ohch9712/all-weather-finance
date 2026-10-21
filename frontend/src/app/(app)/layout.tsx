import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGateFallback } from "@/features/auth/components/AuthGateFallback";
import { OnboardingGate } from "@/features/auth/components/OnboardingGate";
import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { ChatWidget } from "@/features/chat/components/ChatWidget";

/** 로그인한 사용자 화면: RequireAuth → OnboardingGate → AppShell → 본문 + 챗봇 위젯 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    // RequireAuth는 next 경로를 만들려고 useSearchParams를 쓰므로 Suspense 안에 둔다.
    <Suspense fallback={<AuthGateFallback />}>
      <RequireAuth>
        <OnboardingGate>
          <AppShell>{children}</AppShell>
          <div className="print:hidden">
            <ChatWidget />
          </div>
        </OnboardingGate>
      </RequireAuth>
    </Suspense>
  );
}
