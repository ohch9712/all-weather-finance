import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import AccountSettingsPage from "@/app/(app)/settings/account/page";
import { useAuth } from "@/features/auth/AuthProvider";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { apiUrl, authPayload, errorResponse, renderWithProviders, server } from "../utils";

const NOTES = [
  "계정을 삭제하면 자산·가계부·매매일지·가족·증여 기록·관심종목·조건검색·챗봇 대화·연결 정보가 모두 지워지고 되돌릴 수 없습니다.",
  "CODEF 연결이 있으면 CODEF에 등록된 로그인 정보부터 지웁니다. 지우지 못하면 계정 삭제를 멈춥니다.",
  "증권사 앱키는 이 앱에서 지워도 증권사에는 발급된 상태로 남습니다. 필요하면 증권사 포털에서 해지해 주세요.",
  "서버 백업에는 최대 7일 동안 남았다가 지워집니다.",
];
const CODEF_MESSAGE = "CODEF 연결을 지우지 못했습니다. 데이터 자동 수집 화면에서 연결을 먼저 삭제해 주세요.";
const ADMIN_MESSAGE = "마지막 관리자 계정은 삭제할 수 없습니다. 다른 관리자를 먼저 지정해 주세요.";

function AuthStatus() {
  const { status } = useAuth();
  return <output aria-label="인증 상태">{status}</output>;
}

function renderAccount() {
  const result = renderWithProviders(
    <>
      <AccountSettingsPage />
      <AuthStatus />
    </>,
    { route: "/settings/account", auth: authPayload() },
  );
  return result;
}

function passwordInput() {
  return screen.getByLabelText("비밀번호");
}

async function submitDelete(user: ReturnType<typeof renderWithProviders>["user"], password = "gamja1234") {
  await user.type(passwordInput(), password);
  await user.click(screen.getByRole("button", { name: "계정 삭제" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "계정 삭제" }));
  return dialog;
}

function deleteHandler(respond: () => Response | Promise<Response>, sent?: { body?: unknown; count: number }) {
  server.use(
    http.delete(apiUrl("/api/auth/me"), async ({ request }) => {
      if (sent) {
        sent.count += 1;
        sent.body = await request.json();
      }
      return respond();
    }),
  );
}

describe("/settings/account", () => {
  it("계정 정보·처리방침 링크·삭제 안내 네 항목을 보여 준다", async () => {
    renderAccount();
    expect(await screen.findByDisplayValue("potato@example.com")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "계정" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "계정 정보" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "개인정보 처리방침 보기" })).toHaveAttribute("href", "/privacy");
    const danger = screen.getByRole("heading", { name: "계정 삭제" }).closest("[data-slot=card]") as HTMLElement;
    expect(within(danger).getAllByRole("listitem").map((item) => item.textContent)).toEqual(NOTES);
    expect(passwordInput()).toHaveAttribute("type", "password");
    expect(passwordInput()).toHaveAttribute("autocomplete", "current-password");
  });

  it("비밀번호를 비우면 확인 창을 열지 않는다", async () => {
    const { user } = renderAccount();
    await screen.findByDisplayValue("potato@example.com");
    await user.click(screen.getByRole("button", { name: "계정 삭제" }));
    expect(await screen.findByText("비밀번호를 입력해 주세요.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("확인 창을 거쳐 삭제하면 캐시를 비우고 로그아웃 상태로 /login?deleted=1에 간다", async () => {
    const sent = { count: 0 } as { body?: unknown; count: number };
    deleteHandler(() => new HttpResponse(null, { status: 204 }), sent);
    const { user, router, queryClient } = renderAccount();
    await screen.findByDisplayValue("potato@example.com");
    queryClient.setQueryData(["holdings"], { items: ["남은 데이터"] });
    await user.type(passwordInput(), "gamja1234");
    await user.click(screen.getByRole("button", { name: "계정 삭제" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: "정말 계정을 삭제할까요?" })).toBeInTheDocument();
    expect(within(dialog).getByText("이 작업은 되돌릴 수 없습니다.")).toBeInTheDocument();
    // 취소하면 요청하지 않는다.
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(sent.count).toBe(0);

    await user.click(screen.getByRole("button", { name: "계정 삭제" }));
    const again = await screen.findByRole("alertdialog");
    const confirm = within(again).getByRole("button", { name: "계정 삭제" });
    expect(confirm.className).toContain("destructive");
    await user.click(confirm);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?deleted=1"));
    expect(sent).toEqual({ count: 1, body: { password: "gamja1234" } });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(screen.getByLabelText("인증 상태")).toHaveTextContent("unauthenticated");
  });

  it("422는 비밀번호 칸 아래에 보여 주고 비밀번호를 비운다", async () => {
    deleteHandler(() =>
      errorResponse(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", [{ field: "password", message: "비밀번호가 맞지 않습니다." }]),
    );
    const { user, router } = renderAccount();
    await screen.findByDisplayValue("potato@example.com");
    await submitDelete(user, "wrong-password");
    expect(await screen.findByText("비밀번호가 맞지 않습니다.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(passwordInput()).toHaveValue("");
    expect(passwordInput()).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("인증 상태")).toHaveTextContent("authenticated");
  });

  it("409 CODEF 메시지면 데이터 자동 수집 링크를 함께 보여 준다", async () => {
    deleteHandler(() => errorResponse(409, "CONFLICT", CODEF_MESSAGE));
    const { user, router } = renderAccount();
    await screen.findByDisplayValue("potato@example.com");
    await submitDelete(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(CODEF_MESSAGE);
    expect(within(alert).getByRole("link", { name: "데이터 자동 수집으로 이동" })).toHaveAttribute("href", "/settings/connections");
    expect(passwordInput()).toHaveValue("");
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([
    ["마지막 관리자 409", () => errorResponse(409, "CONFLICT", ADMIN_MESSAGE), ADMIN_MESSAGE],
    ["네트워크 오류", () => HttpResponse.error(), "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요."],
  ])("%s는 메시지만 보여 준다", async (_, respond, message) => {
    deleteHandler(respond as () => Response);
    const { user } = renderAccount();
    await screen.findByDisplayValue("potato@example.com");
    await submitDelete(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(within(alert).queryByRole("link")).not.toBeInTheDocument();
    expect(passwordInput()).toHaveValue("");
  });
});

describe("계정 삭제 뒤 로그인 화면", () => {
  it("deleted=1이면 안내를 한 번 보여 주고 주소에서 지운다", async () => {
    const { router } = renderWithProviders(<LoginForm />, { route: "/login?deleted=1", auth: null });
    expect(await screen.findByRole("status")).toHaveTextContent("계정을 삭제했습니다.");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    // 주소가 바뀐 뒤에도 이 화면에서는 안내가 남는다.
    expect(screen.getByText("계정을 삭제했습니다.")).toBeInTheDocument();
  });

  it("deleted가 없으면 안내하지 않는다", async () => {
    const { router } = renderWithProviders(<LoginForm />, { route: "/login", auth: null });
    expect(await screen.findByRole("button", { name: "로그인" })).toBeInTheDocument();
    expect(screen.queryByText("계정을 삭제했습니다.")).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
