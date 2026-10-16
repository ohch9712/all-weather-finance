import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { usePathname } from "next/navigation";
import { describe, expect, it } from "vitest";
import { OnboardingGate } from "@/features/auth/components/OnboardingGate";
import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { apiUrl, authPayload, emptyProfile, renderWithProviders, server } from "../utils";

// 실제 앱처럼 /login은 (app) 레이아웃 밖에서 그린다(이동하면 게이트가 언마운트된다).
function Gated() {
  const pathname = usePathname();
  if (pathname === "/login") return <p>로그인 화면</p>;
  return (
    <RequireAuth>
      <OnboardingGate>
        <p>보호된 화면</p>
      </OnboardingGate>
    </RequireAuth>
  );
}

describe("RequireAuth", () => {
  it("확인 중에는 전체 화면 Skeleton을 보여 준다", () => {
    renderWithProviders(<Gated />, { auth: authPayload() });
    expect(screen.getByRole("status", { name: "로그인 상태를 확인하고 있어요" })).toBeInTheDocument();
    expect(screen.queryByText("보호된 화면")).not.toBeInTheDocument();
  });

  it("로그인했으면 children을 보여 준다", async () => {
    renderWithProviders(<Gated />, { route: "/ledger", auth: authPayload() });
    expect(await screen.findByText("보호된 화면")).toBeInTheDocument();
  });

  it("미인증이면 /login?next=<현재 경로>로 보낸다", async () => {
    const { router } = renderWithProviders(<Gated />, { route: "/ledger", auth: null });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?next=/ledger"));
    expect(await screen.findByText("로그인 화면")).toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it("next에 쿼리 문자열도 담는다", async () => {
    const { router } = renderWithProviders(<Gated />, { route: "/allocation/survey?onboarding=1", auth: null });
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/login?next=/allocation/survey%3Fonboarding%3D1"),
    );
  });

  it("백엔드에 연결하지 못하면 오류 상태와 다시 시도를 보여 주고 이동하지 않는다", async () => {
    server.use(http.get(apiUrl("/api/auth/me"), () => HttpResponse.error()));
    const { user, router } = renderWithProviders(<Gated />, { route: "/ledger" });
    expect(await screen.findByText("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();

    server.use(http.get(apiUrl("/api/auth/me"), () => HttpResponse.json(authPayload())));
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("보호된 화면")).toBeInTheDocument();
  });
});

describe("OnboardingGate", () => {
  it("출생연도가 없으면 /onboarding으로 보낸다", async () => {
    const { router } = renderWithProviders(<Gated />, { route: "/allocation", auth: authPayload({ profile: emptyProfile }) });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
  });

  it("/onboarding에서는 보내지 않고 화면을 보여 준다", async () => {
    const { router } = renderWithProviders(<Gated />, { route: "/onboarding", auth: authPayload({ profile: emptyProfile }) });
    expect(await screen.findByText("보호된 화면")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("출생연도가 있으면 그대로 보여 준다", async () => {
    const { router } = renderWithProviders(<Gated />, { route: "/allocation", auth: authPayload() });
    expect(await screen.findByText("보호된 화면")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
