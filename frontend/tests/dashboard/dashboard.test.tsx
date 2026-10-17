import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/(app)/page";
import { DISCLAIMER_TEXT } from "@/components/common/Disclaimer";
import { CHAT_OPEN_EVENT, type OpenChatWidgetOptions } from "@/features/chat/widget-events";
import { authPayload, renderWithProviders } from "../utils";
import { checklist, emptySummary, fullSummary, mockDashboard } from "./fake-dashboard";

function renderHome() {
  return renderWithProviders(<HomePage />, { auth: authPayload() });
}

function card(name: string) {
  return screen.getByRole("region", { name });
}

describe("홈 대시보드", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("인사와 오늘 날짜(KST), 하단 투자 고지를 보여 준다", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-16T16:30:00Z") });
    mockDashboard(fullSummary());
    renderHome();
    expect(await screen.findByRole("heading", { level: 1, name: "안녕하세요, 감자님" })).toBeInTheDocument();
    // UTC 16:30은 KST로 다음 날 01:30이다.
    expect(screen.getByText("2026년 10월 17일 토요일")).toBeInTheDocument();
    const notes = screen.getAllByRole("note");
    expect(notes.at(-1)).toHaveAttribute("data-variant", "investment");
    expect(notes.at(-1)).toHaveTextContent(DISCLAIMER_TEXT.investment);
  });

  it("데이터가 있는 사용자의 카드를 그린다", async () => {
    mockDashboard(fullSummary());
    renderHome();
    await screen.findByRole("heading", { level: 1, name: "안녕하세요, 감자님" });

    const allocation = card("자산배분");
    expect(within(allocation).getByText("80")).toBeInTheDocument();
    expect(within(allocation).getByText("A등급")).toBeInTheDocument();
    expect(within(allocation).getByText("+3점")).toHaveClass("text-money-up");
    expect(within(allocation).getByRole("img", { name: "실제 자산 비중" })).toBeInTheDocument();
    expect(within(allocation).getByRole("link", { name: "'내 집 마련' 자금은 안전하게" })).toHaveAttribute(
      "href",
      "/allocation/recommendation/detail",
    );
    expect(within(allocation).getByRole("link", { name: "자세히" })).toHaveAttribute("href", "/allocation");

    const ledger = card("10월 가계부");
    expect(within(ledger).getByText("350만원")).toBeInTheDocument();
    expect(within(ledger).getByText("182만원")).toBeInTheDocument();
    expect(within(ledger).getByText("지난달보다 9.45% 줄었어요")).toHaveClass("text-money-down");
    const bars = within(ledger).getAllByRole("progressbar");
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveAccessibleName("식비 지출 비중 28.6%");

    const journal = card("매매 성과");
    expect(within(journal).getByText("+74,040원")).toHaveClass("text-money-up");
    expect(within(journal).getByText("-$12.50")).toHaveClass("text-money-down");
    expect(within(journal).getByText("50.0%")).toBeInTheDocument();
    expect(within(journal).getByText("3종목")).toBeInTheDocument();

    const watchlist = card("관심종목");
    const rows = within(watchlist).getAllByRole("link", { name: /\(\d{6}\)$/ });
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveAttribute("href", "/stocks/005930");
    expect(within(rows[0]).getByText("71,200")).toBeInTheDocument();
    expect(within(rows[0]).getByText("-1.11%").closest("[data-tone]")).toHaveAttribute("data-tone", "down");
    expect(within(rows[1]).getByText("+2.50%").closest("[data-tone]")).toHaveClass("text-money-up");
    expect(within(rows[2]).getByText("0.00%").closest("[data-tone]")).toHaveAttribute("data-tone", "flat");
    expect(within(rows[3]).getAllByText("—")).toHaveLength(2);
    expect(within(watchlist).getByText("샘플 데이터")).toBeInTheDocument();
    expect(within(watchlist).getByRole("link", { name: "더 보기" })).toHaveAttribute("href", "/stocks/watchlist");

    const estate = card("증여 공제");
    expect(within(estate).getByText("첫째")).toBeInTheDocument();
    expect(within(estate).getByText("2,000만원")).toBeInTheDocument();
    expect(within(estate).getByText("10년 안 증여 기록 없음")).toBeInTheDocument();
    expect(within(estate).getByText("다음 회복일 2034.02.02")).toBeInTheDocument();
    expect(within(estate).getByRole("note")).toHaveAttribute("data-variant", "tax");

    const learn = card("오늘의 용어");
    expect(within(learn).getByText("PER")).toBeInTheDocument();
    expect(within(learn).getByText("주가를 주당순이익으로 나눈 값이에요.")).toBeInTheDocument();
    expect(within(learn).getByRole("link", { name: "PER 자세히" })).toHaveAttribute("href", "/learn/per");
    expect(within(learn).getByText("12/35개 읽음")).toBeInTheDocument();
    expect(within(learn).getByRole("progressbar", { name: "학습 진도 34%" })).toBeInTheDocument();

    const chat = card("AI 상담");
    expect(await within(chat).findByText("로컬 AI")).toBeInTheDocument();
    expect(within(chat).getAllByRole("button", { name: /\?$/ })).toHaveLength(3);
  });

  it("신규 사용자는 빈 카드와 다음 단계 안내를 본다", async () => {
    mockDashboard(emptySummary());
    renderHome();
    await screen.findByRole("heading", { level: 1, name: "안녕하세요, potato님" });

    const allocation = card("자산배분");
    expect(within(allocation).getByRole("link", { name: "투자성향 진단하기" })).toHaveAttribute(
      "href",
      "/allocation/survey",
    );
    expect(within(allocation).queryByText("먼저 할 일")).not.toBeInTheDocument();
    expect(within(card("10월 가계부")).getByRole("link", { name: "기록하러 가기" })).toHaveAttribute("href", "/ledger");
    expect(within(card("매매 성과")).getByRole("link", { name: "매매 기록하기" })).toHaveAttribute("href", "/journal");
    const watchlist = card("관심종목");
    expect(within(watchlist).getByRole("link", { name: "관심종목 담기" })).toHaveAttribute("href", "/stocks/watchlist");
    expect(within(watchlist).queryByText("샘플 데이터")).not.toBeInTheDocument();
    const estate = card("증여 공제");
    expect(within(estate).getByRole("link", { name: "가족 등록하기" })).toHaveAttribute("href", "/estate");
    expect(within(estate).queryByRole("note")).not.toBeInTheDocument();
    expect(within(card("오늘의 용어")).getByText("아직 오늘의 용어가 없어요.")).toBeInTheDocument();
  });

  it("배분 리포트 상태마다 다음 단계 버튼이 다르다", async () => {
    mockDashboard(
      emptySummary({
        allocation: {
          status: "needs_holdings",
          score: null,
          grade: null,
          scoreDelta: null,
          classes: null,
          topDirection: { kind: "input_holdings", title: "보유 자산부터 입력하세요", body: "…", href: "/allocation/assets" },
        },
      }),
    );
    renderHome();
    const allocation = await screen.findByRole("region", { name: "자산배분" });
    expect(within(allocation).getByText("먼저 할 일")).toBeInTheDocument();
    expect(within(allocation).getByRole("link", { name: "보유 자산부터 입력하세요" })).toHaveAttribute(
      "href",
      "/allocation/assets",
    );
    expect(within(allocation).getByRole("link", { name: "보유 자산 입력하기" })).toHaveAttribute(
      "href",
      "/allocation/assets",
    );
    expect(within(allocation).queryByRole("img")).not.toBeInTheDocument();
  });

  describe("시작 체크리스트", () => {
    it("진행률과 미완료 항목 링크를 보여 준다", async () => {
      mockDashboard(emptySummary({ checklist: checklist(["risk_assessment", "watchlist"]) }));
      renderHome();
      const list = await screen.findByRole("region", { name: "시작하기" });
      expect(within(list).getByText("2/5 완료")).toBeInTheDocument();
      expect(within(list).getByRole("progressbar", { name: "시작하기 진행률 40%" })).toBeInTheDocument();
      expect(within(list).getByRole("link", { name: /목표·상황 입력하기/ })).toHaveAttribute(
        "href",
        "/allocation/situation",
      );
      expect(within(list).getByRole("link", { name: /투자성향 진단하기/ })).toHaveTextContent("완료");
      expect(within(list).getByRole("link", { name: /보유 자산 입력하기/ })).toHaveTextContent("미완료");
    });

    it("모두 끝내면 숨긴다", async () => {
      mockDashboard(fullSummary({ checklist: checklist("all") }));
      renderHome();
      await screen.findByRole("heading", { level: 1, name: "안녕하세요, 감자님" });
      expect(screen.queryByRole("region", { name: "시작하기" })).not.toBeInTheDocument();
    });
  });

  it("불러오지 못한 섹션만 안내하고 다시 시도하면 새로 받는다", async () => {
    const calls = mockDashboard(
      fullSummary({
        watchlist: null,
        ledger: null,
        errors: [
          { section: "ledger", code: "INTERNAL_ERROR" },
          { section: "watchlist", code: "BROKER_UNAVAILABLE" },
        ],
      }),
      fullSummary(),
    );
    const { user } = renderHome();
    const watchlist = await screen.findByRole("region", { name: "관심종목" });
    expect(within(watchlist).getByRole("alert")).toHaveTextContent("불러오지 못했어요");
    expect(within(card("이번 달 가계부")).getByRole("alert")).toHaveTextContent("불러오지 못했어요");
    // 나머지 카드는 그대로 보인다.
    expect(within(card("매매 성과")).getByText("+74,040원")).toBeInTheDocument();
    expect(within(card("자산배분")).queryByRole("alert")).not.toBeInTheDocument();

    await user.click(within(watchlist).getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(calls.summary).toBe(2));
    expect(await within(card("관심종목")).findByText("삼성전자")).toBeInTheDocument();
    expect(within(card("10월 가계부")).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("요청 전체가 실패하면 오류와 다시 시도를 보여 준다", async () => {
    const calls = mockDashboard("error", emptySummary());
    const { user } = renderHome();
    expect(await screen.findByText("서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("heading", { level: 1, name: "안녕하세요, potato님" })).toBeInTheDocument();
    expect(calls.summary).toBe(2);
  });

  describe("AI 상담", () => {
    it("예시 질문을 누르면 위젯을 열고 질문을 입력창에 채운다", async () => {
      mockDashboard(fullSummary());
      const opened: OpenChatWidgetOptions[] = [];
      const listener = (event: Event) => opened.push((event as CustomEvent<OpenChatWidgetOptions>).detail);
      window.addEventListener(CHAT_OPEN_EVENT, listener);
      try {
        const { user } = renderHome();
        const chat = await screen.findByRole("region", { name: "AI 상담" });
        await user.click(within(chat).getByRole("button", { name: "왜 이렇게 배분하라고 추천했어?" }));
        expect(opened).toEqual([{ draft: "왜 이렇게 배분하라고 추천했어?" }]);
      } finally {
        window.removeEventListener(CHAT_OPEN_EVENT, listener);
      }
    });

    it("AI가 꺼져 있으면 안내하고 질문 버튼을 막는다", async () => {
      mockDashboard(fullSummary({ chat: { enabled: false, location: null } }));
      renderHome();
      const chat = await screen.findByRole("region", { name: "AI 상담" });
      expect(within(chat).getByText(/AI 상담이 꺼져 있어요/)).toBeInTheDocument();
      for (const button of within(chat).getAllByRole("button", { name: /\?$/ })) {
        expect(button).toBeDisabled();
      }
    });
  });

  it("카드 격자는 모바일 1열, 태블릿 2열, 데스크톱 3열이다", async () => {
    mockDashboard(fullSummary());
    renderHome();
    await screen.findByRole("heading", { level: 1, name: "안녕하세요, 감자님" });
    const grid = screen.getByTestId("dashboard-grid");
    expect(grid).toHaveClass("grid-cols-1", "md:grid-cols-2", "xl:grid-cols-3");
    expect(within(grid).getAllByRole("region")).toHaveLength(7);
  });
});
