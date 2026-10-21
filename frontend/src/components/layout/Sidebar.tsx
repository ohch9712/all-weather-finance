import Link from "next/link";
import { LogoMark } from "@/components/common/LogoMark";
import { ScrollArea } from "@/components/ui/scroll-area";
import { APP_NAME } from "@/lib/site";
import { NavLinks } from "./NavLinks";

/** 데스크톱(≥1024px) 왼쪽 고정 사이드바 */
export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex print:hidden">
      <div className="flex h-14 shrink-0 items-center px-5">
        <Link href="/" className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight">
          <LogoMark />
          <span className="truncate">{APP_NAME}</span>
        </Link>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pt-2 pb-6">
          <NavLinks />
        </div>
      </ScrollArea>
    </aside>
  );
}
