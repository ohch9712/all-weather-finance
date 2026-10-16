import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AllocationReportView, diffLabel } from "@/features/allocation/components/AllocationReportView";
import { renderWithProviders } from "../utils";
import { REPORT_READY, emptyReport, installFakeAllocationApi } from "./fake-api";
import { RECOMMENDATION_NEEDS_HOLDINGS } from "./responses";

describe("자산배분 리포트(9.2)", () => {
  it("ready: 점수 카드, 도넛 두 개, 차이 막대, 리밸런싱 표, 제외 자산, 추천 링크, 고지", async () => {
    installFakeAllocationApi({
      scores: [
        { scoredOn: "2026-10-15", score: 55, grade: "D" },
        { scoredOn: "2026-10-16", score: 58, grade: "D" },
      ],
    });
    renderWithProviders(<AllocationReportView />, { route: "/allocation" });

    const score = await screen.findByRole("heading", { name: "배분 점수" });
    const card = score.closest("[data-slot=card]") as HTMLElement;
    expect(card).toHaveTextContent("58점");
    expect(within(card).getByText("D등급")).toBeInTheDocument();
    expect(card).toHaveTextContent("권장 배분과 많이 달라요. 아래 안내를 참고하세요.");
    expect(within(card).getByLabelText("지난번보다 3점 올랐어요")).toHaveTextContent("▲3");

    expect(screen.getByRole("heading", { name: "목표 반영 권장" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "내 자산" })).toBeInTheDocument();
    expect(screen.getByText("점수 계산에서 뺀 자산 3억원")).toBeInTheDocument();

    const diffs = screen.getByRole("list", { name: "자산군별 비중 차이(실제 − 권장)" });
    expect(within(diffs).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "주식+17.5%p",
      "채권-39.4%p",
      "금-2.5%p",
      "현금성 자산+24.4%p",
      "기타0.0%p",
    ]);

    const table = screen.getByRole("table", { name: "리밸런싱 표" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["2,600만원", "1,690만원", "-910만원 줄이기"],
      ["600만원", "2,650만원", "+2,050만원 더 모으기"],
      ["0원", "130만원", "+130만원 더 모으기"],
      ["2,000만원", "730만원", "-1,270만원 줄이기"],
      ["0원", "0원", "맞아요"],
    ]);
    expect(screen.getByText("차이 금액은 비중 차이를 알려 주는 참고값이에요. 특정 상품의 매매를 권하는 것이 아니에요.")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "점수 이력" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /추천 결과 보기/ })).toHaveAttribute("href", "/allocation/recommendation");
    expect(screen.getByRole("link", { name: "왜 이렇게 추천했나요?" })).toHaveAttribute(
      "href",
      "/allocation/recommendation/detail",
    );
    expect(screen.getByRole("button", { name: "나이대·성향별 표 보기" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("투자 권유가 아닙니다");
  });

  it("점수 이력이 2개 미만이면 선 그래프를 숨기고, 변화가 없으면 화살표 대신 문구", async () => {
    installFakeAllocationApi({
      report: { ...REPORT_READY, scoreDelta: null, excludedAmount: 0 },
      scores: [{ scoredOn: "2026-10-16", score: 58, grade: "D" }],
    });
    renderWithProviders(<AllocationReportView />, { route: "/allocation" });
    expect(await screen.findByRole("heading", { name: "배분 점수" })).toBeInTheDocument();
    expect(screen.queryByText(/▲|▼/)).not.toBeInTheDocument();
    expect(screen.queryByText(/점수 계산에서 뺀 자산/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "점수 이력" })).not.toBeInTheDocument();
  });

  it("점수가 내리면 ▼", async () => {
    installFakeAllocationApi({ report: { ...REPORT_READY, scoreDelta: -2, score: 92, grade: "S" } });
    renderWithProviders(<AllocationReportView />, { route: "/allocation" });
    expect(await screen.findByLabelText("지난번보다 2점 내렸어요")).toHaveTextContent("▼2");
    expect(screen.getByText("권장 배분과 거의 같아요. 지금처럼 유지하세요.")).toBeInTheDocument();
  });

  it("needs_holdings: 권장 배분 도넛과 보유 자산 입력 버튼", async () => {
    installFakeAllocationApi({ report: emptyReport("needs_holdings"), recommendation: RECOMMENDATION_NEEDS_HOLDINGS });
    renderWithProviders(<AllocationReportView />, { route: "/allocation" });
    expect(await screen.findByRole("heading", { name: "내 권장 배분" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "내 권장 배분" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "보유 자산 입력하기" })).toHaveAttribute("href", "/allocation/assets");
    expect(screen.queryByRole("heading", { name: "배분 점수" })).not.toBeInTheDocument();
  });

  it("needs_assessment: 투자성향 진단하기 버튼", async () => {
    installFakeAllocationApi({ report: emptyReport("needs_assessment") });
    renderWithProviders(<AllocationReportView />, { route: "/allocation" });
    expect(await screen.findByRole("link", { name: "투자성향 진단하기" })).toHaveAttribute("href", "/allocation/survey");
    expect(screen.getByRole("note")).toHaveTextContent("투자 권유가 아닙니다");
  });

  it("needs_profile: 출생연도 입력 안내", async () => {
    installFakeAllocationApi({ report: emptyReport("needs_profile") });
    renderWithProviders(<AllocationReportView />, { route: "/allocation" });
    expect(await screen.findByRole("link", { name: "출생연도 입력하기" })).toHaveAttribute("href", "/onboarding");
  });

  it("차이 문구", () => {
    expect(diffLabel(7_800_000)).toBe("+780만원 더 모으기");
    expect(diffLabel(-1_200_000)).toBe("-120만원 줄이기");
    expect(diffLabel(0)).toBe("맞아요");
  });
});
