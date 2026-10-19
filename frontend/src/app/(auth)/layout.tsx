import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/common/LogoMark";
import { APP_NAME } from "@/lib/site";

/** 앱 셸 없는 로그인·가입 화면 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-muted/40 px-4 py-10 sm:justify-center">
      <Link href="/" className="mb-6 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <LogoMark className="size-6" />
        {APP_NAME}
      </Link>
      <main className="w-full max-w-sm">{children}</main>
      <Link href="/privacy" className="mt-6 text-xs text-muted-foreground underline-offset-4 hover:underline">
        개인정보 처리방침
      </Link>
    </div>
  );
}
