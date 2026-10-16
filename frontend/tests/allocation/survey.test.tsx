import { screen, waitFor } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { SurveyWizard } from "@/features/allocation/components/SurveyWizard";
import { apiUrl, errorResponse, renderWithProviders, server } from "../utils";
import { LATEST_ASSESSMENT, installFakeAllocationApi } from "./fake-api";
import { SURVEY } from "./responses";

const PICKS = ["1년 ~ 3년", "주식, 주식형 펀드, ETF", "주식과 채권의 위험 차이를 설명할 수 있다", "안정적으로 유지될 것 같다", "20% ~ 30%", "20% 이내"];

async function answerAll(user: ReturnType<typeof renderWithProviders>["user"]) {
  for (const [index, label] of PICKS.entries()) {
    expect(await screen.findByRole("heading", { level: 2, name: SURVEY.questions[index].text })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: label }));
    if (index < PICKS.length - 1) await user.click(screen.getByRole("button", { name: "다음" }));
  }
}

describe("투자성향 설문(9.1)", () => {
  it("한 화면에 한 문항, 진행률, 답하기 전에는 다음을 막고 이전으로 돌아가면 답을 기억한다", async () => {
    installFakeAllocationApi();
    const { user } = renderWithProviders(<SurveyWizard />, { route: "/allocation/survey" });

    expect(await screen.findByRole("heading", { level: 2, name: "이 돈을 얼마 동안 투자할 수 있나요?" })).toBeInTheDocument();
    expect(screen.getByText("1/6")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "이전" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "5년 이상" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByText("2/6")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "지금까지 투자해 본 상품 중 가장 위험한 것은 무엇인가요?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "이전" }));
    expect(screen.getByRole("radio", { name: "5년 이상" })).toBeChecked();
    expect(screen.queryByText("1/3 투자성향")).not.toBeInTheDocument();
  });

  it("제출하면 POST 후 추천 결과로 간다", async () => {
    const api = installFakeAllocationApi();
    const { user, router } = renderWithProviders(<SurveyWizard />, { route: "/allocation/survey" });
    await answerAll(user);
    expect(screen.queryByRole("button", { name: "다음" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "결과 보기" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/allocation/recommendation"));
    expect(api.writes()).toEqual([
      {
        method: "POST",
        path: "/api/allocation/risk-assessments",
        body: {
          surveyVersion: 1,
          answers: { horizon: 3, experience: 4, knowledge: 3, income: 3, investmentRatio: 3, lossTolerance: 3 },
        },
      },
    ]);
  });

  it("온보딩이면 진행 표시를 보여 주고 제출 후 목표·상황으로 간다", async () => {
    installFakeAllocationApi();
    const { user, router } = renderWithProviders(<SurveyWizard />, { route: "/allocation/survey?onboarding=1" });
    expect(await screen.findByText("투자성향", { selector: "p" })).toHaveTextContent("1/3 투자성향");
    await answerAll(user);
    await user.click(screen.getByRole("button", { name: "결과 보기" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/allocation/situation?onboarding=1"));
  });

  it("다시 진단할 때는 지난 답을 미리 골라 둔다", async () => {
    installFakeAllocationApi({ latestAssessment: LATEST_ASSESSMENT });
    renderWithProviders(<SurveyWizard />, { route: "/allocation/survey" });
    expect(await screen.findByRole("radio", { name: "1년 ~ 3년" })).toBeChecked();
    expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
  });

  it("설문 버전이 바뀌었다는 422는 문구를 보여 주고 이동하지 않는다", async () => {
    installFakeAllocationApi();
    server.use(
      http.post(apiUrl("/api/allocation/risk-assessments"), () =>
        errorResponse(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", [
          { field: "surveyVersion", message: "설문이 바뀌었습니다. 새로고침해 주세요." },
        ]),
      ),
    );
    const { user, router } = renderWithProviders(<SurveyWizard />, { route: "/allocation/survey" });
    await answerAll(user);
    await user.click(screen.getByRole("button", { name: "결과 보기" }));
    expect(await screen.findByText("설문이 바뀌었습니다. 새로고침해 주세요.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});
