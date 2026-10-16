import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { OnboardingForm } from "@/app/(app)/onboarding/OnboardingForm";
import type { AuthPayload } from "@/features/auth/types";
import { currentKstYear } from "@/lib/format";
import { apiUrl, authPayload, emptyProfile, errorResponse, renderWithProviders, server } from "../utils";

function mockProfileSave(onBody: (body: unknown) => void) {
  let saved: AuthPayload = authPayload({ profile: emptyProfile });
  server.use(
    http.get(apiUrl("/api/auth/me"), () => HttpResponse.json(saved)),
    http.put(apiUrl("/api/profile"), async ({ request }) => {
      const body = (await request.json()) as { birthYear: number; nickname: string | null };
      onBody(body);
      saved = authPayload({ profile: { birthYear: body.birthYear, nickname: body.nickname, age: 32, ageBand: "30s" } });
      return HttpResponse.json(saved.profile);
    }),
  );
}

describe("온보딩", () => {
  it("안내 문구와 출생연도 선택지(올해−10부터 1920까지 내림차순)를 보여 준다", async () => {
    const { user } = renderWithProviders(<OnboardingForm />, { route: "/onboarding", auth: authPayload({ profile: emptyProfile }) });
    expect(
      screen.getByText("나이대와 투자성향, 목표에 따라 권장 자산배분이 달라져요. 먼저 출생연도를 알려 주세요."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "출생연도" }));
    const options = await screen.findAllByRole("option");
    const maxYear = currentKstYear() - 10;
    expect(options[0]).toHaveTextContent(`${maxYear}년`);
    expect(options.at(-1)).toHaveTextContent("1920년");
    expect(options).toHaveLength(maxYear - 1920 + 1);
  });

  it("출생연도를 고르지 않으면 저장하지 않는다", async () => {
    const { user } = renderWithProviders(<OnboardingForm />, { route: "/onboarding", auth: authPayload({ profile: emptyProfile }) });
    await user.click(screen.getByRole("button", { name: "저장하고 계속하기" }));
    expect(await screen.findByText("출생연도를 선택해 주세요.")).toBeInTheDocument();
  });

  it("저장하면 PUT /api/profile → refresh → /allocation/survey?onboarding=1로 간다", async () => {
    let body: unknown;
    mockProfileSave((value) => {
      body = value;
    });
    const { user, router } = renderWithProviders(<OnboardingForm />, { route: "/onboarding" });
    await user.click(await screen.findByRole("combobox", { name: "출생연도" }));
    await user.click(await screen.findByRole("option", { name: "1994년" }));
    await user.type(screen.getByLabelText("닉네임"), "  감자  ");
    await user.click(screen.getByRole("button", { name: "저장하고 계속하기" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/allocation/survey?onboarding=1"));
    expect(body).toEqual({ birthYear: 1994, nickname: "감자" });
  });

  it("닉네임을 비우면 null로 보낸다", async () => {
    let body: unknown;
    mockProfileSave((value) => {
      body = value;
    });
    const { user, router } = renderWithProviders(<OnboardingForm />, { route: "/onboarding" });
    await user.click(await screen.findByRole("combobox", { name: "출생연도" }));
    await user.click(await screen.findByRole("option", { name: "2000년" }));
    await user.click(screen.getByRole("button", { name: "저장하고 계속하기" }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(body).toEqual({ birthYear: 2000, nickname: null });
  });

  it("서버 검증 에러는 해당 필드 아래에 보여 준다", async () => {
    server.use(
      http.put(apiUrl("/api/profile"), () =>
        errorResponse(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", [
          { field: "birthYear", message: "출생연도를 확인해 주세요." },
        ]),
      ),
    );
    const { user, router } = renderWithProviders(<OnboardingForm />, { route: "/onboarding", auth: authPayload({ profile: emptyProfile }) });
    await user.click(await screen.findByRole("combobox", { name: "출생연도" }));
    await user.click(await screen.findByRole("option", { name: "1994년" }));
    await user.click(screen.getByRole("button", { name: "저장하고 계속하기" }));
    expect(await screen.findByText("출생연도를 확인해 주세요.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});
