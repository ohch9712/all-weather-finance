import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { SignupForm } from "@/features/auth/components/SignupForm";
import { apiUrl, authPayload, emptyProfile, errorResponse, renderWithProviders, server } from "../utils";

function fieldInput(label: string) {
  return screen.getByLabelText(label);
}

describe("SignupForm", () => {
  it("클라이언트 검증: 이메일 형식, 비밀번호 길이, 확인 입력", async () => {
    const { user } = renderWithProviders(<SignupForm />, { auth: null });
    await user.click(screen.getByRole("button", { name: "가입하기" }));
    expect(await screen.findByText("올바른 이메일 형식이 아닙니다.")).toBeInTheDocument();
    expect(screen.getByText("비밀번호는 8~128자로 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("비밀번호를 한 번 더 입력해 주세요.")).toBeInTheDocument();
    expect(fieldInput("이메일")).toHaveAttribute("aria-invalid", "true");
  });

  it("비밀번호가 규칙을 어기면 불일치 검사는 하지 않는다", async () => {
    const { user } = renderWithProviders(<SignupForm />, { auth: null });
    await user.type(fieldInput("이메일"), "potato@example.com");
    await user.type(fieldInput("비밀번호"), "short");
    await user.type(fieldInput("비밀번호 확인"), "different");
    await user.click(screen.getByRole("button", { name: "가입하기" }));
    expect(await screen.findByText("비밀번호는 8~128자로 입력해 주세요.")).toBeInTheDocument();
    expect(screen.queryByText("비밀번호가 일치하지 않습니다.")).not.toBeInTheDocument();
  });

  it("비밀번호 확인이 다르면 불일치 에러를 보여 주고 요청하지 않는다", async () => {
    let called = false;
    server.use(
      http.post(apiUrl("/api/auth/signup"), () => {
        called = true;
        return HttpResponse.json(authPayload(), { status: 201 });
      }),
    );
    const { user } = renderWithProviders(<SignupForm />, { auth: null });
    await user.type(fieldInput("이메일"), "potato@example.com");
    await user.type(fieldInput("비밀번호"), "gamja1234");
    await user.type(fieldInput("비밀번호 확인"), "gamja12345");
    await user.click(screen.getByRole("button", { name: "가입하기" }));
    expect(await screen.findByText("비밀번호가 일치하지 않습니다.")).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("409 EMAIL_ALREADY_EXISTS는 이메일 필드 아래에 보여 준다", async () => {
    server.use(http.post(apiUrl("/api/auth/signup"), () => errorResponse(409, "EMAIL_ALREADY_EXISTS", "이미 가입된 이메일입니다.")));
    const { user } = renderWithProviders(<SignupForm />, { auth: null });
    await user.type(fieldInput("이메일"), "potato@example.com");
    await user.type(fieldInput("비밀번호"), "gamja1234");
    await user.type(fieldInput("비밀번호 확인"), "gamja1234");
    await user.click(screen.getByRole("button", { name: "가입하기" }));
    expect(await screen.findByText("이미 가입된 이메일입니다.")).toBeInTheDocument();
    expect(fieldInput("이메일")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("422 details는 해당 필드 아래, 필드 없는 에러는 폼 위 Alert로 보여 준다", async () => {
    server.use(
      http.post(apiUrl("/api/auth/signup"), () =>
        errorResponse(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", [
          { field: "passwordConfirm", message: "비밀번호가 일치하지 않습니다." },
        ]),
      ),
    );
    const { user } = renderWithProviders(<SignupForm />, { auth: null });
    await user.type(fieldInput("이메일"), "potato@example.com");
    await user.type(fieldInput("비밀번호"), "gamja1234");
    await user.type(fieldInput("비밀번호 확인"), "gamja1234");
    await user.click(screen.getByRole("button", { name: "가입하기" }));
    expect(await screen.findByText("비밀번호가 일치하지 않습니다.")).toBeInTheDocument();
    expect(fieldInput("비밀번호 확인")).toHaveAttribute("aria-invalid", "true");

    server.use(http.post(apiUrl("/api/auth/signup"), () => HttpResponse.error()));
    await user.click(screen.getByRole("button", { name: "가입하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("가입에 성공하면 로그인 상태가 되고 /onboarding으로 간다", async () => {
    let body: unknown;
    server.use(
      http.post(apiUrl("/api/auth/signup"), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(authPayload({ profile: emptyProfile }), { status: 201 });
      }),
    );
    const { user, router } = renderWithProviders(<SignupForm />, { auth: null });
    await user.type(fieldInput("이메일"), " Potato@Example.com ");
    await user.type(fieldInput("비밀번호"), "gamja1234");
    await user.type(fieldInput("비밀번호 확인"), "gamja1234");
    await user.click(screen.getByRole("button", { name: "가입하기" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/onboarding"));
    expect(body).toEqual({ email: "Potato@Example.com", password: "gamja1234", passwordConfirm: "gamja1234" });
    expect(router.replace).not.toHaveBeenCalledWith("/");
  });

  it("이미 로그인 상태면 /로 보낸다", async () => {
    const { router } = renderWithProviders(<SignupForm />, { route: "/signup", auth: authPayload() });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });
});

describe("LoginForm", () => {
  it("클라이언트 검증: 이메일 형식, 비밀번호 입력", async () => {
    const { user } = renderWithProviders(<LoginForm />, { route: "/login", auth: null });
    await user.type(fieldInput("이메일"), "potato");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByText("올바른 이메일 형식이 아닙니다.")).toBeInTheDocument();
    expect(screen.getByText("비밀번호를 입력해 주세요.")).toBeInTheDocument();
  });

  it("401 INVALID_CREDENTIALS는 폼 위 Alert로 보여 준다", async () => {
    server.use(
      http.post(apiUrl("/api/auth/login"), () =>
        errorResponse(401, "INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다."),
      ),
    );
    const { user, router } = renderWithProviders(<LoginForm />, { route: "/login", auth: null });
    await user.type(fieldInput("이메일"), "potato@example.com");
    await user.type(fieldInput("비밀번호"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이메일 또는 비밀번호가 올바르지 않습니다.");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("로그인에 성공하면 next 경로로 간다", async () => {
    server.use(http.post(apiUrl("/api/auth/login"), () => HttpResponse.json(authPayload())));
    const { user, router } = renderWithProviders(<LoginForm />, { route: "/login?next=/ledger%3Fmonth%3D2026-10", auth: null });
    await user.type(fieldInput("이메일"), "potato@example.com");
    await user.type(fieldInput("비밀번호"), "gamja1234");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/ledger?month=2026-10"));
    expect(router.replace).not.toHaveBeenCalledWith("/");
  });

  it.each([
    ["//evil.example.com"],
    ["https://evil.example.com"],
    ["/\\evil.example.com"],
    ["/\n/evil.example.com"],
    ["/\r/evil.example.com"],
    ["/\t/evil.example.com"],
    ["javascript:alert(1)"],
    ["/.//verify.invalid"],
    ["/a/..//verify.invalid"],
    ["/%2e//verify.invalid"],
    ["/.\\/verify.invalid"],
  ])(
    "다른 사이트로 가는 next(%j)는 무시하고 /로 간다",
    async (next) => {
      server.use(http.post(apiUrl("/api/auth/login"), () => HttpResponse.json(authPayload())));
      const { user, router } = renderWithProviders(<LoginForm />, {
        route: `/login?next=${encodeURIComponent(next)}`,
        auth: null,
      });
      await user.type(fieldInput("이메일"), "potato@example.com");
      await user.type(fieldInput("비밀번호"), "gamja1234");
      await user.click(screen.getByRole("button", { name: "로그인" }));
      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    },
  );

  it("이미 로그인 상태면 /로 보낸다", async () => {
    const { router } = renderWithProviders(<LoginForm />, { route: "/login", auth: authPayload() });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });
});
