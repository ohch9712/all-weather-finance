import { useEffect } from "react";
import { act, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { useAuth, type AuthContextValue } from "@/features/auth/AuthProvider";
import { apiUrl, authPayload, errorResponse, renderWithProviders, server } from "../utils";

// 테스트에서 컨텍스트 함수(setAuth·refresh·logout)를 직접 부르려고 마지막 값을 잡아 둔다.
const captured: { current: AuthContextValue | null } = { current: null };
const auth = new Proxy({} as AuthContextValue, {
  get: (_target, key) => (captured.current as unknown as Record<PropertyKey, unknown>)[key],
});

function Probe() {
  const value = useAuth();
  useEffect(() => {
    captured.current = value;
  });
  return (
    <p data-testid="probe">
      {value.status}|{value.user?.email ?? "-"}|{value.profile?.nickname ?? "-"}|{value.error?.code ?? "-"}
    </p>
  );
}

const probe = () => screen.getByTestId("probe");

describe("AuthProvider", () => {
  it("마운트하면 /api/auth/me를 불러 loading → authenticated로 바뀐다", async () => {
    renderWithProviders(<Probe />, { auth: authPayload() });
    expect(probe()).toHaveTextContent("loading|-|-|-");
    await waitFor(() => expect(probe()).toHaveTextContent("authenticated|potato@example.com|감자|-"));
  });

  it("401이면 unauthenticated(에러 없음)", async () => {
    renderWithProviders(<Probe />, { auth: null });
    await waitFor(() => expect(probe()).toHaveTextContent("unauthenticated|-|-|-"));
  });

  it("백엔드에 연결하지 못하면 unauthenticated + NETWORK_ERROR", async () => {
    server.use(http.get(apiUrl("/api/auth/me"), () => HttpResponse.error()));
    renderWithProviders(<Probe />);
    await waitFor(() => expect(probe()).toHaveTextContent("unauthenticated|-|-|NETWORK_ERROR"));
  });

  it("setAuth는 응답으로 바로 로그인 상태가 된다", async () => {
    renderWithProviders(<Probe />, { auth: null });
    await waitFor(() => expect(probe()).toHaveTextContent("unauthenticated"));
    act(() => auth.setAuth(authPayload({ profile: { nickname: "고구마" } })));
    expect(probe()).toHaveTextContent("authenticated|potato@example.com|고구마|-");
  });

  it("refresh는 /me를 다시 불러 프로필을 갱신한다", async () => {
    renderWithProviders(<Probe />, { auth: authPayload() });
    await waitFor(() => expect(probe()).toHaveTextContent("감자"));
    server.use(http.get(apiUrl("/api/auth/me"), () => HttpResponse.json(authPayload({ profile: { nickname: "고구마" } }))));
    await act(() => auth.refresh());
    expect(probe()).toHaveTextContent("authenticated|potato@example.com|고구마|-");
  });

  it("로그인된 상태에서 refresh가 네트워크 오류면 화면을 유지하고 에러를 던진다", async () => {
    renderWithProviders(<Probe />, { auth: authPayload() });
    await waitFor(() => expect(probe()).toHaveTextContent("authenticated"));
    server.use(http.get(apiUrl("/api/auth/me"), () => HttpResponse.error()));
    await act(async () => {
      await expect(auth.refresh()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });
    expect(probe()).toHaveTextContent("authenticated|potato@example.com");
  });

  it("logout은 POST /api/auth/logout → 쿼리 캐시 비움 → /login 이동", async () => {
    let logoutCalls = 0;
    server.use(
      http.post(apiUrl("/api/auth/logout"), () => {
        logoutCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { queryClient, router } = renderWithProviders(<Probe />, { route: "/settings/profile", auth: authPayload() });
    await waitFor(() => expect(probe()).toHaveTextContent("authenticated"));
    queryClient.setQueryData(["ledger", "entries"], [{ id: 1 }]);

    await act(() => auth.logout());

    expect(logoutCalls).toBe(1);
    expect(queryClient.getQueryData(["ledger", "entries"])).toBeUndefined();
    expect(router.push).toHaveBeenCalledWith("/login");
    expect(probe()).toHaveTextContent("unauthenticated|-|-|-");
    expect(auth.signedOut).toBe(true);
  });

  it("logout 요청이 실패하면 로그인 상태를 유지하고 에러를 던진다", async () => {
    server.use(http.post(apiUrl("/api/auth/logout"), () => errorResponse(500, "INTERNAL_ERROR", "서버 오류가 발생했습니다.")));
    const { router } = renderWithProviders(<Probe />, { auth: authPayload() });
    await waitFor(() => expect(probe()).toHaveTextContent("authenticated"));
    await act(async () => {
      await expect(auth.logout()).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    });
    expect(probe()).toHaveTextContent("authenticated");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("늦게 도착한 최초 /me 응답이 setAuth 결과를 덮어쓰지 않는다", async () => {
    let release: () => void = () => {};
    server.use(
      http.get(apiUrl("/api/auth/me"), async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return errorResponse(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
      }),
    );
    renderWithProviders(<Probe />);
    act(() => auth.setAuth(authPayload()));
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(probe()).toHaveTextContent("authenticated|potato@example.com");
  });
});
