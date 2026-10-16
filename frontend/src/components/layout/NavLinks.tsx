"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/features/auth/AuthProvider";
import { NAV_GROUPS, getVisibleNavItems, isNavItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface NavLinksProps {
  /** 링크를 누르면 부른다(모바일 메뉴 닫기). */
  onNavigate?: () => void;
}

/** 사이드바와 모바일 메뉴가 함께 쓰는 메뉴 목록. `lib/navigation.ts`의 NAV_ITEMS만 읽는다. */
export function NavLinks({ onNavigate }: NavLinksProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const items = getVisibleNavItems(user?.role);

  return (
    <nav aria-label="주 메뉴" className="flex flex-col gap-5">
      {NAV_GROUPS.map(({ group, label }) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        const headingId = `nav-group-${group}`;
        return (
          <div key={group} className="flex flex-col gap-1">
            {label && (
              <p id={headingId} className="px-3 text-xs font-medium text-muted-foreground">
                {label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5" aria-labelledby={label ? headingId : undefined}>
              {groupItems.map((item) => {
                const active = isNavItemActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
