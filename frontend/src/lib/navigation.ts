import {
  BadgePercent,
  BookOpen,
  Bot,
  ChartPie,
  Funnel,
  House,
  Landmark,
  NotebookPen,
  Plug,
  Shield,
  Star,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

// 메뉴(architecture 12.1). 사이드바와 모바일 메뉴는 이 배열만 읽는다.

export type NavGroup = "main" | "stocks" | "settings" | "admin";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  adminOnly?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "홈", icon: House, group: "main" },
  { href: "/allocation", label: "자산배분", icon: ChartPie, group: "main" },
  { href: "/ledger", label: "가계부", icon: Wallet, group: "main" },
  { href: "/journal", label: "매매일지", icon: NotebookPen, group: "main" },
  { href: "/stocks/watchlist", label: "관심종목", icon: Star, group: "stocks" },
  { href: "/stocks/screener", label: "조건검색", icon: Funnel, group: "stocks" },
  { href: "/estate", label: "상속·증여", icon: Landmark, group: "main" },
  { href: "/learn", label: "배우기", icon: BookOpen, group: "main" },
  { href: "/chat", label: "AI 상담", icon: Bot, group: "main" },
  { href: "/settings/profile", label: "프로필", icon: UserRound, group: "settings" },
  { href: "/settings/connections", label: "증권사 연결", icon: Plug, group: "settings" },
  { href: "/settings/trading-costs", label: "매매 수수료·세금", icon: BadgePercent, group: "settings" },
  { href: "/admin/learn", label: "학습 콘텐츠 관리", icon: Shield, group: "admin", adminOnly: true },
];

/** 그룹 표시 순서와 제목. `main`은 제목 없이 맨 위에 둔다. */
export const NAV_GROUPS: readonly { group: NavGroup; label: string | null }[] = [
  { group: "main", label: null },
  { group: "stocks", label: "주식" },
  { group: "settings", label: "설정" },
  { group: "admin", label: "관리자" },
];

/** 관리자 메뉴는 `role === "admin"`일 때만 보인다. */
export function getVisibleNavItems(role: string | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");
}

/** 현재 경로가 메뉴 항목에 속하는지. `/`는 정확히 같을 때만, 나머지는 하위 경로까지 포함한다. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 현재 경로에 해당하는 메뉴 항목(가장 긴 href 우선). 상단 바 제목에 쓴다. */
export function findActiveNavItem(pathname: string): NavItem | undefined {
  return [...NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => isNavItemActive(pathname, item.href));
}
