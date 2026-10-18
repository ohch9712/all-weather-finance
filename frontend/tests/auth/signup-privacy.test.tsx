import { render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import AuthLayout from "@/app/(auth)/layout";
import { NavLinks } from "@/components/layout/NavLinks";
import { SignupForm } from "@/features/auth/components/SignupForm";
import { apiUrl, authPayload, emptyProfile, renderWithProviders, server } from "../utils";

async function fillSignup(user: ReturnType<typeof renderWithProviders>["user"]) {
  await user.type(screen.getByLabelText("이메일"), "potato@example.com");
  await user.type(screen.getByLabelText("비밀번호"), "gamja1234");
  await user.type(screen.getByLabelText("비밀번호 확인"), "gamja1234");
}

describe("가입 화면 만 14세 확인", () => {
  it("체크하지 않으면 오류를 보여 주고 요청하지 않는다", async () => {
    let called = false;
    server.use(
      http.post(apiUrl("/api/auth/signup"), () => {
        called = true;
        return HttpResponse.json(authPayload({ profile: emptyProfile }), { status: 201 });
      }),
    );
    const { user } = renderWithProviders(<SignupForm />, { auth: null });
    await fillSignup(user);
    const checkbox = screen.getByRole("checkbox", { name: "만 14세 이상입니다." });
    expect(checkbox).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "가입하기" }));
    expect(await screen.findByText("만 14세 이상만 가입할 수 있습니다.")).toBeInTheDocument();
    expect(checkbox).toHaveAttribute("aria-invalid", "true");
    expect(called).toBe(false);

    // 체크하면 오류가 사라지고 가입한다. 체크 값은 서버로 보내지 않는다.
    let body: unknown;
    server.use(
      http.post(apiUrl("/api/auth/signup"), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(authPayload({ profile: emptyProfile }), { status: 201 });
      }),
    );
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    await user.click(screen.getByRole("button", { name: "가입하기" }));
    await waitFor(() => expect(body).toEqual({ email: "potato@example.com", password: "gamja1234", passwordConfirm: "gamja1234" }));
  });

  it("제출 버튼 위에 처리방침 안내와 새 창 링크가 있다", () => {
    renderWithProviders(<SignupForm />, { auth: null });
    const notice = screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "가입하면 개인정보 처리방침에 따라 개인정보가 처리됩니다.");
    const link = within(notice).getByRole("link", { name: "개인정보 처리방침" });
    expect(link).toHaveAttribute("href", "/privacy");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const checkbox = screen.getByRole("checkbox", { name: "만 14세 이상입니다." });
    const submit = screen.getByRole("button", { name: "가입하기" });
    // 체크박스 → 안내 → 제출 버튼 순서
    expect(checkbox.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("로그인·가입 레이아웃", () => {
  it("본문 아래에 개인정보 처리방침 링크가 있다", () => {
    render(
      <AuthLayout>
        <p>본문</p>
      </AuthLayout>,
    );
    const main = screen.getByRole("main");
    const link = screen.getByRole("link", { name: "개인정보 처리방침" });
    expect(link).toHaveAttribute("href", "/privacy");
    expect(main.contains(link)).toBe(false);
    expect(main.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("내비게이션 계정 항목", () => {
  it("설정 그룹에서 프로필 다음에 계정이 있다", async () => {
    renderWithProviders(<NavLinks />, { auth: authPayload() });
    const group = await screen.findByRole("list", { name: "설정" });
    const links = within(group).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["프로필", "계정", "증권사 연결", "매매 수수료·세금"]);
    expect(within(group).getByRole("link", { name: "계정" })).toHaveAttribute("href", "/settings/account");
  });
});
