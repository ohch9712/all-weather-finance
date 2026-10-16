import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecommendationDetail } from "@/features/allocation/components/RecommendationDetail";
import { RecommendationView, firstSentence } from "@/features/allocation/components/RecommendationView";
import { renderWithProviders } from "../utils";
import { goal, installFakeAllocationApi } from "./fake-api";
import {
  RECOMMENDATION_APPLIED,
  RECOMMENDATION_NEEDS_ASSESSMENT,
  RECOMMENDATION_NEEDS_HOLDINGS,
  RECOMMENDATION_NEEDS_PROFILE,
} from "./responses";

const INVESTMENT_NOTICE = /이 서비스의 자산배분·종목 정보는 일반적인 정보 제공과 학습을 위한 것이며 투자 권유가 아닙니다/;

describe("추천 결과(9.5)", () => {
  it("applied: 칩, 권장 금액 범례, 층 요약, 먼저 할 일 3개, 이유 요약, 링크, 고지", async () => {
    installFakeAllocationApi();
    renderWithProviders(<RecommendationView />, { route: "/allocation/recommendation" });

    expect(await screen.findByRole("heading", { level: 1, name: "내 추천 결과" })).toBeInTheDocument();
    const chips = await screen.findByRole("list", { name: "내 정보 요약" });
    expect(within(chips).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "30대",
      "위험중립형(57.8점)",
      "비상금 3개월",
    ]);
    // 칩 아래 한 줄 설명과 추천 이유 요약(성향 문장 첫 문장)
    expect(screen.getAllByText("수익과 위험의 균형을 원해요.")).toHaveLength(2);
    // 범례(와 같은 데이터의 숨김 표)에 권장 금액
    expect(screen.getAllByText("주식 1,690만원").length).toBeGreaterThan(0);
    expect(screen.getAllByText("채권 2,650만원").length).toBeGreaterThan(0);
    // 층 요약
    const layers = screen.getByRole("heading", { name: "층별 금액" }).closest("section") as HTMLElement;
    expect(within(layers).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "비상금600만원11.5%",
      "가까운 목표2,000만원38.5%",
      "장기 투자2,600만원50.0%",
    ]);

    const todo = screen.getByRole("heading", { name: "먼저 할 일" }).closest("[data-slot=card]") as HTMLElement;
    const items = within(todo).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByRole("heading", { level: 3 })).toHaveTextContent("'내 집 마련' 자금은 안전하게");
    expect(items[0]).toHaveTextContent("2028년 10월에 쓸 2,000만원은 값이 크게 흔들리지 않는 채권으로 모아 두는 것을 권해요.");
    expect(within(items[0]).getByRole("link", { name: /자세히 보기/ })).toHaveAttribute("href", "/allocation/recommendation/detail");
    expect(within(items[1]).getByRole("heading", { level: 3 })).toHaveTextContent("채권 비중을 늘려요");
    expect(within(items[1]).getByRole("link", { name: /리포트 보기/ })).toHaveAttribute("href", "/allocation");
    expect(screen.queryByText("'노후 준비'은 장기 투자로 준비해요")).not.toBeInTheDocument();

    const reasons = screen.getByRole("heading", { name: "추천 이유" }).closest("[data-slot=card]") as HTMLElement;
    expect(within(reasons).getAllByRole("listitem")).toHaveLength(3);
    expect(reasons).toHaveTextContent("나이대: 30대");
    expect(reasons).toHaveTextContent("투자할 수 있는 기간이 길수록 위험자산(주식+기타) 비중을 높게 잡아요.");
    expect(reasons).not.toHaveTextContent("대표 나이 35세");
    expect(reasons).toHaveTextContent("투자성향: 위험중립형(57.8점)");

    expect(screen.getByRole("link", { name: "왜 이렇게 추천했는지 자세히 보기" })).toHaveAttribute(
      "href",
      "/allocation/recommendation/detail",
    );
    expect(screen.getByRole("link", { name: "자산배분 리포트 보기" })).toHaveAttribute("href", "/allocation");
    expect(screen.getByRole("note")).toHaveTextContent(INVESTMENT_NOTICE);
    expect(screen.queryByText("설정을 마쳤어요. 이렇게 관리해 보세요.")).not.toBeInTheDocument();
  });

  it("needs_holdings: 표 비중 도넛과 자산 입력 안내, 보유 자산 입력 버튼", async () => {
    installFakeAllocationApi({ recommendation: RECOMMENDATION_NEEDS_HOLDINGS });
    renderWithProviders(<RecommendationView />, { route: "/allocation/recommendation?onboarding=1" });
    expect(await screen.findByText(/자산을 입력하면 비상금과 목표 자금을 반영해요/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "층별 금액" })).not.toBeInTheDocument();
    // 범례는 비중만(금액 없음)
    expect(screen.queryByText(/^주식 \d/)).not.toBeInTheDocument();
    expect(screen.getAllByText("65.0%").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "보유 자산 입력하기" })).toHaveAttribute("href", "/allocation/assets");
    const todo = screen.getByRole("heading", { name: "먼저 할 일" }).closest("[data-slot=card]") as HTMLElement;
    expect(todo).toHaveTextContent("생활비 200만원의 3개월치인 600만원을 비상금으로 먼저 모아 두세요.");
    expect(todo).toHaveTextContent("보유 자산을 입력해 주세요");
    // 온보딩 안내
    expect(screen.getByText("설정을 마쳤어요. 이렇게 관리해 보세요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "홈으로" })).toHaveAttribute("href", "/");
  });

  it("needs_profile: 출생연도 입력 안내", async () => {
    installFakeAllocationApi({ recommendation: RECOMMENDATION_NEEDS_PROFILE });
    renderWithProviders(<RecommendationView />, { route: "/allocation/recommendation" });
    expect(await screen.findByText("출생연도를 먼저 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "출생연도 입력하기" })).toHaveAttribute("href", "/onboarding");
    expect(screen.getByRole("note")).toHaveTextContent(INVESTMENT_NOTICE);
  });

  it("needs_assessment: 투자성향 진단 버튼", async () => {
    installFakeAllocationApi({ recommendation: RECOMMENDATION_NEEDS_ASSESSMENT });
    renderWithProviders(<RecommendationView />, { route: "/allocation/recommendation" });
    expect(await screen.findByRole("link", { name: "투자성향 진단하기" })).toHaveAttribute("href", "/allocation/survey");
  });

  it("본문 첫 문장은 숫자 속 마침표에서 자르지 않는다", () => {
    expect(firstSentence("투자성향 57.8점이에요. 둘째 문장")).toBe("투자성향 57.8점이에요.");
    expect(firstSentence("마침표 없음")).toBe("마침표 없음");
  });
});

describe("상세 설명(9.6)", () => {
  it("내 정보, 층 순서, 위험자산 계산, 답변 막대·합계 각주, 이유·역할, 방향 전체", async () => {
    installFakeAllocationApi({
      situation: {
        monthlyExpense: 2_000_000,
        dependents: 0,
        consumerDebt: 0,
        emergencyMonths: 3,
        emergencyTarget: 6_000_000,
        updatedAt: "2026-10-16T03:00:00Z",
      },
      goals: [
        goal({ id: "g1" }),
        goal({ id: "g2", goalType: "retirement", title: "노후 준비", targetAmount: 500_000_000, targetDate: "2056-10-16", horizon: "long_term" }),
      ],
    });
    renderWithProviders(<RecommendationDetail />, { route: "/allocation/recommendation/detail" });

    expect(await screen.findByRole("heading", { level: 2, name: "1. 내 정보" })).toBeInTheDocument();
    expect(screen.getByText(/\(1994년생\)/)).toBeInTheDocument();
    expect(screen.getByText("생활비 200만원 · 부양가족 0명 · 고금리 대출 0원")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "투자성향 수정" })).toHaveAttribute("href", "/allocation/survey");
    expect(screen.getByRole("link", { name: "상황 수정" })).toHaveAttribute("href", "/allocation/situation");

    const order = screen.getByRole("list", { name: "층 순서" });
    const steps = within(order).getAllByRole("listitem").filter((item) => item.parentElement === order);
    expect(steps.map((step) => step.querySelector("p")?.textContent)).toEqual([
      "① 비상금 → 현금성 자산",
      "② 3년 안에 쓸 목표 자금 → 현금성 자산·채권",
      "③ 나머지 → 장기 투자(나이대·성향 표 비중)",
    ]);
    expect(steps[0]).toHaveTextContent("생활비 200만원의 3개월치(600만원) 중 600만원을 먼저 떼어 두었어요.");
    expect(steps[1]).toHaveTextContent("'내 집 마련' 2028년 10월 2,000만원 → 채권");
    expect(steps[2]).toHaveTextContent("주식 65% · 채권 25% · 금 5% · 현금성 자산 5% · 기타 0%");
    // 장기 투자 몫 2,600만원을 나눈 결과: 주식 1,690만원 · 채권 650만원 · 금 130만원 · 현금 130만원 · 기타 0원
    expect(steps[2]).toHaveTextContent("장기 투자 몫 2,600만원을 나눈 결과");
    expect(within(steps[2]).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "주식1,690만원",
      "채권650만원",
      "금130만원",
      "현금성 자산130만원",
      "기타0원",
    ]);

    expect(screen.getByText("100 − 35 = 65%")).toBeInTheDocument();
    expect(screen.getByText("0%p")).toBeInTheDocument();
    expect(screen.getByText("해당 없음")).toBeInTheDocument();

    const answers = screen.getByRole("heading", { name: "4. 내 답변과 성향 점수" }).closest("[data-slot=card]") as HTMLElement;
    expect(within(answers).getAllByRole("progressbar")).toHaveLength(6);
    expect(answers).toHaveTextContent("10.0 / 20.0점");
    expect(answers).toHaveTextContent("13.3 / 26.7점");
    expect(answers).toHaveTextContent("합계(진단 점수)57.8점");
    expect(answers).toHaveTextContent("문항별 점수는 반올림해서 합이 0.1점 다를 수 있어요.");

    const reasons = screen.getByRole("heading", { name: "5. 추천 이유" }).closest("[data-slot=card]") as HTMLElement;
    expect(reasons).toHaveTextContent("대표 나이 35세 기준 출발점은 100 − 35 = 65%예요.");
    expect(reasons).toHaveTextContent("장기 투자 몫: 2,600만원");
    expect(reasons).toHaveTextContent("권장 32.5%");

    const directions = screen.getByRole("list", { name: "관리 방향 전체" });
    expect(within(directions).getAllByRole("heading", { level: 3 }).map((item) => item.textContent)).toEqual([
      "'내 집 마련' 자금은 안전하게",
      "채권 비중을 늘려요",
      "현금성 자산 비중을 줄여요",
      "'노후 준비'은 장기 투자로 준비해요",
    ]);
    expect(screen.getByRole("button", { name: "나이대·성향별 표 보기" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(INVESTMENT_NOTICE);
  });

  it("needs_holdings면 순서만 설명한다", async () => {
    installFakeAllocationApi({ recommendation: RECOMMENDATION_NEEDS_HOLDINGS });
    renderWithProviders(<RecommendationDetail />, { route: "/allocation/recommendation/detail" });
    expect(await screen.findByText("자산을 입력하면 아래 순서로 금액을 나눠요.")).toBeInTheDocument();
    expect(screen.getByText("생활비 200만원의 3개월치(600만원)를 먼저 떼어 둬요.")).toBeInTheDocument();
    expect(screen.queryByText(/장기 투자 몫 .*을 나눈 결과/)).not.toBeInTheDocument();
  });

  it("표 다이얼로그에서 내 칸을 강조한다", async () => {
    installFakeAllocationApi();
    const { user } = renderWithProviders(<RecommendationDetail />, { route: "/allocation/recommendation/detail" });
    await user.click(await screen.findByRole("button", { name: "나이대·성향별 표 보기" }));
    const dialog = await screen.findByRole("dialog", { name: "나이대·성향별 권장 배분표" });
    expect(within(dialog).getByRole("button", { name: "30대" })).toHaveAttribute("aria-pressed", "true");
    const mine = within(dialog).getByText("내 배분").closest("tr") as HTMLElement;
    expect(mine).toHaveTextContent("위험중립형");
    expect(within(mine).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["65", "25", "5", "5", "0"]);

    await user.click(within(dialog).getByRole("button", { name: "20대" }));
    expect(within(dialog).queryByText("내 배분")).not.toBeInTheDocument();
    const aggressive = within(dialog).getByRole("rowheader", { name: "공격투자형" }).closest("tr") as HTMLElement;
    expect(within(aggressive).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["80", "0", "5", "5", "10"]);
  });
});
