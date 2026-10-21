import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavLinks } from "@/components/layout/NavLinks";
import { NAV_ITEMS, findActiveNavItem, getVisibleNavItems, isNavItemActive } from "@/lib/navigation";
import { authPayload, renderWithProviders } from "../utils";

describe("내비게이션 데이터(architecture 12.1)", () => {
  it("메뉴 경로가 아키텍처 표와 같다", () => {
    expect(NAV_ITEMS.map((item) => [item.label, item.href])).toEqual([
      ["홈", "/"],
      ["자산배분", "/allocation"],
      ["가계부", "/ledger"],
      ["매매일지", "/journal"],
      ["관심종목", "/stocks/watchlist"],
      ["조건검색", "/stocks/screener"],
      ["상속·증여", "/estate"],
      ["상속·증여(과제)", "/succession"],
      ["배우기", "/learn"],
      ["AI 상담", "/chat"],
      ["프로필", "/settings/profile"],
      ["계정", "/settings/account"],
      ["증권사 연결", "/settings/connections"],
      ["매매 수수료·세금", "/settings/trading-costs"],
      ["학습 콘텐츠 관리", "/admin/learn"],
    ]);
    expect(NAV_ITEMS.filter((item) => item.adminOnly).map((item) => item.href)).toEqual(["/admin/learn"]);
  });

  it("관리자 메뉴는 admin에게만 보인다", () => {
    expect(getVisibleNavItems("user").some((item) => item.adminOnly)).toBe(false);
    expect(getVisibleNavItems(undefined).some((item) => item.adminOnly)).toBe(false);
    expect(getVisibleNavItems("admin").some((item) => item.adminOnly)).toBe(true);
  });

  it("현재 경로 판정: /는 정확히 같을 때만, 나머지는 하위 경로 포함", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/ledger", "/")).toBe(false);
    expect(isNavItemActive("/allocation/survey", "/allocation")).toBe(true);
    expect(isNavItemActive("/allocations", "/allocation")).toBe(false);
    expect(findActiveNavItem("/stocks/watchlist")?.label).toBe("관심종목");
    expect(findActiveNavItem("/stocks/005930")).toBeUndefined();
  });
});

describe("NavLinks", () => {
  it("일반 사용자에게는 관리자 메뉴를 숨긴다", async () => {
    renderWithProviders(<NavLinks />, { auth: authPayload() });
    expect(await screen.findByRole("link", { name: "자산배분" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "학습 콘텐츠 관리" })).not.toBeInTheDocument();
    expect(screen.queryByText("관리자")).not.toBeInTheDocument();
  });

  it("관리자에게는 관리자 메뉴를 보여 준다", async () => {
    renderWithProviders(<NavLinks />, { auth: authPayload({ user: { role: "admin" } }) });
    expect(await screen.findByRole("link", { name: "학습 콘텐츠 관리" })).toHaveAttribute("href", "/admin/learn");
    expect(screen.getByText("관리자")).toBeInTheDocument();
  });

  it("현재 경로 항목을 강조한다(aria-current)", async () => {
    renderWithProviders(<NavLinks />, { route: "/allocation/survey", auth: authPayload() });
    const active = await screen.findByRole("link", { name: "자산배분" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "홈" })).not.toHaveAttribute("aria-current");
    const nav = screen.getByRole("navigation", { name: "주 메뉴" });
    expect(within(nav).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(1);
  });

  it("주식 메뉴는 '주식' 그룹 아래에 모인다", async () => {
    renderWithProviders(<NavLinks />, { auth: authPayload() });
    const group = await screen.findByRole("list", { name: "주식" });
    expect(within(group).getAllByRole("link").map((link) => link.textContent)).toEqual(["관심종목", "조건검색"]);
  });
});
