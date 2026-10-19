import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import SignupPage from "@/app/(auth)/signup/page";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { SignupForm } from "@/features/auth/components/SignupForm";
import { apiUrl, authPayload, emptyProfile, errorResponse, renderWithProviders, server } from "../utils";

// 가입 비밀번호 8~32자와 '가입 시' 문구(스펙 01 7.3·12.2, 스펙 19 5.2, 2026-10-19)

const LENGTH_MESSAGE = "비밀번호는 8~32자로 입력해 주세요.";

type User = ReturnType<typeof renderWithProviders>["user"];

// 긴 값과 이모지는 한 글자씩 치지 않고 붙여 넣는다.
async function fill(user: User, label: string, value: string) {
  await user.click(screen.getByLabelText(label));
  await user.paste(value);
}

async function submitSignup(user: User, password: string) {
  await fill(user, "이메일", "potato@example.com");
  await fill(user, "비밀번호", password);
  await fill(user, "비밀번호 확인", password);
  await user.click(screen.getByLabelText("만 14세 이상입니다."));
  await user.click(screen.getByRole("button", { name: "가입하기" }));
}

describe("가입 화면 문구", () => {
  it("카드 설명과 비밀번호 안내가 새 문구다", () => {
    renderWithProviders(<SignupPage />, { route: "/signup", auth: null });
    expect(screen.getByText("가입 시 바로 로그인되고, 출생연도를 입력하는 화면으로 이어져요.")).toBeInTheDocument();
    expect(screen.getByText("8~32자로 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "가입 시 개인정보 처리방침에 따라 개인정보가 처리됩니다.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("가입하면");
    expect(document.body.textContent).not.toContain("8~128");
  });
});

describe("가입 비밀번호 길이(문자 수 기준 8~32자)", () => {
  it.each([
    ["7자", "x".repeat(7)],
    ["33자", "x".repeat(33)],
    ["한글 33자", "가".repeat(33)],
    ["이모지 33자", "😀".repeat(33)],
  ])("%s는 거절하고 요청하지 않는다", async (_, password) => {
    let called = false;
    server.use(
      http.post(apiUrl("/api/auth/signup"), () => {
        called = true;
        return HttpResponse.json(authPayload({ profile: emptyProfile }), { status: 201 });
      }),
    );
    const { user } = renderWithProviders(<SignupForm />, { auth: null });
    await submitSignup(user, password);
    expect(await screen.findByText(LENGTH_MESSAGE)).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).toHaveAttribute("aria-invalid", "true");
    // 비밀번호가 규칙을 어기면 불일치 검사는 하지 않는다.
    expect(screen.queryByText("비밀번호가 일치하지 않습니다.")).not.toBeInTheDocument();
    expect(called).toBe(false);
  });

  it.each([
    ["8자", "x".repeat(8)],
    ["32자", "x".repeat(32)],
    // UTF-16 코드 유닛으로는 64개지만 문자로는 32자다.
    ["이모지 32자", "😀".repeat(32)],
  ])("%s는 받아서 가입한다", async (_, password) => {
    let body: unknown;
    server.use(
      http.post(apiUrl("/api/auth/signup"), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(authPayload({ profile: emptyProfile }), { status: 201 });
      }),
    );
    const { user, router } = renderWithProviders(<SignupForm />, { auth: null });
    await submitSignup(user, password);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/onboarding"));
    expect(body).toEqual({ email: "potato@example.com", password, passwordConfirm: password });
    expect(screen.queryByText(LENGTH_MESSAGE)).not.toBeInTheDocument();
  });

  it("서버 422 비밀번호 길이 오류는 비밀번호 칸 아래에 보여 준다", async () => {
    server.use(
      http.post(apiUrl("/api/auth/signup"), () =>
        errorResponse(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", [{ field: "password", message: "길이를 확인해 주세요." }]),
      ),
    );
    const { user } = renderWithProviders(<SignupForm />, { auth: null });
    await submitSignup(user, "gamja1234");
    expect(await screen.findByText("길이를 확인해 주세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("로그인 폼은 비밀번호 길이를 검사하지 않는다", () => {
  it.each([
    ["7자", "x".repeat(7)],
    ["이전 규칙 33자", "x".repeat(33)],
    ["이전 규칙 128자", "x".repeat(128)],
    ["이모지 128자", "😀".repeat(128)],
  ])("%s도 그대로 서버로 보낸다", async (_, password) => {
    let body: unknown;
    server.use(
      http.post(apiUrl("/api/auth/login"), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(authPayload());
      }),
    );
    const { user, router } = renderWithProviders(<LoginForm />, { route: "/login", auth: null });
    await fill(user, "이메일", "potato@example.com");
    await fill(user, "비밀번호", password);
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(body).toEqual({ email: "potato@example.com", password });
    expect(screen.queryByText(LENGTH_MESSAGE)).not.toBeInTheDocument();
  });

  it("빈 비밀번호만 막는다", async () => {
    const { user } = renderWithProviders(<LoginForm />, { route: "/login", auth: null });
    await fill(user, "이메일", "potato@example.com");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByText("비밀번호를 입력해 주세요.")).toBeInTheDocument();
  });
});
