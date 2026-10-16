"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { findActiveNavItem } from "@/lib/navigation";
import { APP_NAME } from "@/lib/site";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { UserMenu } from "./UserMenu";

/** 앱 셸: 데스크톱 고정 사이드바, 상단 바(현재 메뉴 이름·사용자 메뉴), 최대 1200px 본문 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = findActiveNavItem(pathname);

  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        본문으로 건너뛰기
      </a>
      <Sidebar />
      <div className="flex min-h-dvh min-w-0 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-8">
          <MobileNav />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">
            <span className="lg:hidden">{current?.label ?? APP_NAME}</span>
            <span className="hidden text-muted-foreground lg:inline">{current?.label ?? ""}</span>
          </p>
          <UserMenu />
        </header>
        <main id="main-content" className="mx-auto w-full max-w-[1200px] min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
