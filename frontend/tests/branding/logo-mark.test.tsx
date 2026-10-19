import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AuthLayout from "@/app/(auth)/layout";
import { LOGO_MARK_PATHS, LOGO_MARK_VIEW_BOX, LogoMark } from "@/components/common/LogoMark";
import { MobileNav } from "@/components/layout/MobileNav";
import { Sidebar } from "@/components/layout/Sidebar";
import { PrivacyPolicy } from "@/features/privacy/components/PrivacyPolicy";
import type { PrivacyValues } from "@/features/privacy/config";
import { APP_NAME } from "@/lib/site";
import { renderWithProviders } from "../utils";

const markSvg = readFileSync(join(process.cwd(), "public", "brand", "logo-mark.svg"), "utf8");

const PRIVACY_VALUES: PrivacyValues = {
  operatorName: null,
  officerName: null,
  contactEmail: null,
  hostingProvider: null,
  effectiveDate: null,
};

function marksIn(element: HTMLElement): SVGSVGElement[] {
  return Array.from(element.querySelectorAll<SVGSVGElement>('svg[data-slot="logo-mark"]'));
}

/** 서비스 이름 링크(또는 제목) 안에 장식용 마크가 정확히 하나 있고 이름은 그대로다. */
function expectBrand(element: HTMLElement) {
  expect(element).toHaveAccessibleName(APP_NAME);
  expect(element).toHaveTextContent(APP_NAME);
  const marks = marksIn(element);
  expect(marks).toHaveLength(1);
  expect(marks[0]).toHaveAttribute("aria-hidden", "true");
  // 마크가 글자 앞에 온다.
  expect(element.firstElementChild).toBe(marks[0]);
}

describe("LogoMark", () => {
  it("장식용(aria-hidden)이고 기본 크기는 size-5, className으로 크기를 바꾼다", () => {
    const { container, rerender } = render(<LogoMark />);
    const svg = marksIn(container)[0];
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("size-5");
    expect(svg).toHaveAttribute("viewBox", LOGO_MARK_VIEW_BOX);
    rerender(<LogoMark className="size-8" />);
    expect(marksIn(container)[0]).toHaveClass("size-8");
    expect(marksIn(container)[0]).not.toHaveClass("size-5");
  });

  it("public/brand/logo-mark.svg와 같은 viewBox·네 조각 경로를 그린다", () => {
    expect(markSvg).toContain(`viewBox="${LOGO_MARK_VIEW_BOX}"`);
    const filePaths = Array.from(markSvg.matchAll(/<path[^>]* d="([^"]+)"/g), (match) => match[1]);
    expect(filePaths).toEqual(Object.values(LOGO_MARK_PATHS));
    const { container } = render(<LogoMark />);
    const drawn = Array.from(container.querySelectorAll("path"), (path) => path.getAttribute("d"));
    expect(drawn).toEqual(Object.values(LOGO_MARK_PATHS));
  });

  it("여러 개를 그려도 그라데이션 id가 겹치지 않고, 각 조각이 자기 SVG 안의 그라데이션을 쓴다", () => {
    const { container } = render(
      <>
        <LogoMark />
        <LogoMark />
      </>,
    );
    const ids = Array.from(container.querySelectorAll("linearGradient, radialGradient"), (node) => node.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
    for (const svg of marksIn(container)) {
      for (const path of Array.from(svg.querySelectorAll("path"))) {
        const ref = /^url\(#(.+)\)$/.exec(path.getAttribute("fill") ?? "")?.[1];
        expect(ref).toBeDefined();
        expect(svg.querySelector(`[id="${ref}"]`)).not.toBeNull();
      }
    }
  });
});

describe("서비스 이름 앞의 브랜드 마크", () => {
  it("사이드바", () => {
    const { container } = renderWithProviders(<Sidebar />);
    const link = screen.getByRole("link", { name: APP_NAME });
    expect(link).toHaveAttribute("href", "/");
    expectBrand(link);
    expect(marksIn(container)).toHaveLength(1);
  });

  it("모바일 메뉴 제목", async () => {
    const { user } = renderWithProviders(<MobileNav />);
    await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
    const dialog = await screen.findByRole("dialog", { name: APP_NAME });
    const title = within(dialog).getByText(APP_NAME);
    expectBrand(title);
  });

  it("로그인·가입 화면(auth 레이아웃)", () => {
    render(
      <AuthLayout>
        <p>본문</p>
      </AuthLayout>,
    );
    const link = screen.getByRole("link", { name: APP_NAME });
    expect(link).toHaveAttribute("href", "/");
    expectBrand(link);
  });

  it("개인정보 처리방침 머리", () => {
    render(<PrivacyPolicy values={PRIVACY_VALUES} />);
    const link = screen.getByRole("link", { name: APP_NAME });
    expect(link).toHaveAttribute("href", "/");
    expectBrand(link);
  });
});
