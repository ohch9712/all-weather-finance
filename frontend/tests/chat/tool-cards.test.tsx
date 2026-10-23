import type { ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatCard, hasCardRenderer } from "@/features/chat/cards/registry";
import type {
  AllocationCard,
  Card,
  ComparisonCard,
  DirectionsCard,
  GiftTaxCard,
  LinkListCard,
  SpendingCard,
  StockCard,
  StockListCard,
  TableCard,
} from "@/features/chat/types";

// 15 전용 카드 8종(스펙 15 5절·8절): 샘플 배지, 고지, 링크, comparison 추천 표시

function renderCard(card: Card | { type: string }): ReturnType<typeof render> {
  const ui: ReactElement = (
    <TooltipProvider delayDuration={0}>
      <ChatCard card={card} />
    </TooltipProvider>
  );
  return render(ui);
}

function disclaimers(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[role="note"][data-variant]')).map((node) => node.getAttribute("data-variant") ?? "");
}

const allocation: AllocationCard = {
  type: "allocation",
  status: "ready",
  score: 62,
  grade: "B",
  classes: [
    { assetClass: "stock", label: "주식", actualWeight: 60, targetWeight: 50 },
    { assetClass: "bond", label: "채권", actualWeight: 30, targetWeight: 35 },
    { assetClass: "gold", label: "금", actualWeight: 0, targetWeight: 5 },
    { assetClass: "cash", label: "현금성 자산", actualWeight: 10, targetWeight: 10 },
    { assetClass: "other", label: "기타", actualWeight: 0, targetWeight: 0 },
  ],
  href: "/allocation",
};

describe("15 카드 렌더러", () => {
  it("8종 타입이 모두 레지스트리에 있다", () => {
    for (const type of ["allocation", "spending", "stock", "stock_list", "gift_tax", "link_list", "directions", "comparison"]) {
      expect(hasCardRenderer(type)).toBe(true);
    }
    expect(hasCardRenderer("donut_chart")).toBe(false);
  });

  it("allocation: 점수·등급 도넛과 실제·권장 비중, 자산배분 링크", () => {
    const { container } = renderCard(allocation);
    expect(container.querySelector('[data-card-type="allocation"]')).not.toBeNull();
    expect(screen.getByRole("img", { name: "자산군별 실제 비중" })).toBeInTheDocument();
    expect(screen.getByText("62점")).toBeInTheDocument();
    expect(screen.getByText("B등급")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "자산군별 실제 비중과 권장 비중" });
    const stockRow = within(table).getByRole("row", { name: /주식/ });
    expect(within(stockRow).getByText("60.0%")).toBeInTheDocument();
    expect(within(stockRow).getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /자산배분 화면에서 보기/ })).toHaveAttribute("href", "/allocation");
    // 리포트에 Mock 여부가 없어 샘플 배지를 달지 않는다(4.1).
    expect(screen.queryByText("샘플 데이터")).not.toBeInTheDocument();
  });

  it("allocation: 데이터 없음 상태면 도넛 대신 안내", () => {
    renderCard({ ...allocation, status: "needs_assessment", score: null, grade: null, classes: [] });
    expect(screen.getByText("투자성향 진단을 하면 배분 점수를 볼 수 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /자산배분 화면에서 보기/ })).toHaveAttribute("href", "/allocation");
  });

  it("spending: 합계, 지출 상위 카테고리, 가계부 링크", () => {
    const card: SpendingCard = {
      type: "spending",
      month: "2026년 10월",
      incomeTotal: "3,000,000원",
      expenseTotal: "620,000원",
      net: "2,380,000원",
      topCategories: [
        { name: "식비", amount: "300,000원", ratio: "48.4%" },
        { name: "교통", amount: "120,000원", ratio: "19.4%" },
      ],
      href: "/ledger?month=2026-10",
    };
    renderCard(card);
    expect(screen.getByText("2026년 10월 수입·지출")).toBeInTheDocument();
    expect(screen.getByText("620,000원")).toBeInTheDocument();
    expect(screen.getByText("식비")).toBeInTheDocument();
    expect(screen.getByText("48.4%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /가계부에서 보기/ })).toHaveAttribute("href", "/ledger?month=2026-10");
  });

  const stock: StockCard = {
    type: "stock",
    code: "005930",
    name: "삼성전자",
    price: "102,800원",
    changeRate: "-1.21%",
    metrics: [
      { label: "PER", value: "12.34배" },
      { label: "시가총액", value: "613조원" },
    ],
    source: "mock",
    href: "/stocks/005930",
  };

  it("stock: Mock이면 샘플 배지와 sample 고지", () => {
    const { container } = renderCard(stock);
    expect(screen.getByText("샘플 데이터")).toBeInTheDocument();
    expect(disclaimers(container)).toEqual(["sample"]);
    expect(screen.getByText("102,800원")).toBeInTheDocument();
    expect(screen.getByText("-1.21%")).toHaveClass("text-money-down");
    expect(screen.getByText("12.34배")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /종목 상세 보기/ })).toHaveAttribute("href", "/stocks/005930");
  });

  it("stock: 실제 시세면 배지·고지가 없다", () => {
    const { container } = renderCard({ ...stock, source: "kiwoom", changeRate: "+2.00%" });
    expect(screen.queryByText("샘플 데이터")).not.toBeInTheDocument();
    expect(disclaimers(container)).toEqual([]);
    expect(screen.getByText("+2.00%")).toHaveClass("text-money-up");
  });

  it("stock_list: 종목 마스터 검색은 배지·전체 보기 없이 종목 링크만", () => {
    const card: StockListCard = {
      type: "stock_list",
      title: "'삼성' 종목 검색",
      asOf: null,
      source: "master",
      items: [{ code: "005930", name: "삼성전자", price: null, changeRate: null, extra: "코스피" }],
      href: null,
    };
    const { container } = renderCard(card);
    expect(screen.queryByText("샘플 데이터")).not.toBeInTheDocument();
    expect(disclaimers(container)).toEqual([]);
    expect(screen.getByRole("link", { name: /삼성전자/ })).toHaveAttribute("href", "/stocks/005930");
    expect(screen.getByText("005930 · 코스피")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /전체 보기/ })).not.toBeInTheDocument();
  });

  it("stock_list: 조건검색 Mock 결과는 기준일·배지·전체 보기 링크", () => {
    const card: StockListCard = {
      type: "stock_list",
      title: "조건검색 결과 12개",
      asOf: "2026.10.16",
      source: "mock",
      items: [
        { code: "005930", name: "삼성전자", price: "102,800원", changeRate: "-1.21%", extra: "코스피 · PER 9.10배" },
        { code: "000660", name: "SK하이닉스", price: "201,000원", changeRate: "+0.50%", extra: null },
      ],
      href: "/stocks/screener?f=abc",
    };
    const { container } = renderCard(card);
    expect(screen.getByText("2026.10.16 기준")).toBeInTheDocument();
    expect(screen.getByText("샘플 데이터")).toBeInTheDocument();
    expect(disclaimers(container)).toEqual(["sample"]);
    expect(screen.getByRole("link", { name: /전체 보기/ })).toHaveAttribute("href", "/stocks/screener?f=abc");
    expect(screen.getByRole("link", { name: /SK하이닉스/ })).toHaveAttribute("href", "/stocks/000660");
  });

  it("gift_tax: 계산 단계, 납부할 세금, tax 고지, 계산기 링크", () => {
    const card: GiftTaxCard = {
      type: "gift_tax",
      title: "첫째 증여세 계산",
      steps: [
        { label: "증여재산가액", amount: "100,000,000원", note: null },
        { label: "증여재산공제", amount: "50,000,000원", note: "10년 합산" },
      ],
      payableTax: "4,850,000원",
      href: "/estate?tab=gift-tax",
    };
    const { container } = renderCard(card);
    expect(screen.getByText("증여재산공제")).toBeInTheDocument();
    expect(screen.getByText("10년 합산")).toBeInTheDocument();
    expect(screen.getByText("4,850,000원")).toBeInTheDocument();
    expect(disclaimers(container)).toEqual(["tax"]);
    expect(screen.getByRole("link", { name: /증여세 계산기에서 보기/ })).toHaveAttribute("href", "/estate?tab=gift-tax");
  });

  it("link_list: 앱 내부 경로만 그리고 없으면 카드를 그리지 않는다", () => {
    const card: LinkListCard = {
      type: "link_list",
      title: "'PER' 학습 자료",
      links: [
        { title: "PER 주가수익비율", description: "주가를 주당순이익으로 나눈 값", href: "/learn/per" },
        { title: "외부", description: null, href: "https://example.com" },
      ],
    };
    const { container } = renderCard(card);
    expect(screen.getByRole("link", { name: /PER 주가수익비율/ })).toHaveAttribute("href", "/learn/per");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    const empty = renderCard({ ...card, links: [card.links[1]] });
    expect(empty.container).toBeEmptyDOMElement();
  });

  it("directions: 먼저 할 일, 금액, investment 고지, 상세 링크", () => {
    const card: DirectionsCard = {
      type: "directions",
      title: "먼저 할 일",
      items: [
        { title: "비상금 먼저 채우기", body: "생활비 6개월치를 현금성 자산으로 둡니다.", amount: "15,000,000원" },
        { title: "주식 비중 줄이기", body: "권장 비중보다 10%p 많습니다.", amount: null },
      ],
      href: "/allocation/recommendation/detail",
    };
    const { container } = renderCard(card);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("15,000,000원")).toBeInTheDocument();
    expect(disclaimers(container)).toEqual(["investment"]);
    expect(screen.getByRole("link", { name: /추천 이유 자세히 보기/ })).toHaveAttribute(
      "href",
      "/allocation/recommendation/detail",
    );
  });

  it("comparison: 방향마다 남는 금액·상속 시점 기준 총 세금·낸 총 세금, 추천 표시는 하나, tax 고지, 비교 링크", () => {
    // 06 8.1 사례 3(17절): 낸 금액은 lump_sum_now가 적지만 상속 시점 기준으로는 staged_children이 적다.
    const card: ComparisonCard = {
      type: "comparison",
      title: "상속·증여 방향 비교",
      horizonDate: "2066.10.16",
      rows: [
        {
          key: "staged_children",
          label: "자녀에게 10년마다 공제 한도만큼 증여",
          totalTaxAtHorizon: "483,098,314원",
          totalTax: "483,098,314원",
          familyReceives: "4,413,922,523원",
          recommended: true,
        },
        {
          key: "lump_sum_now",
          label: "자녀에게 지금 500,000,000원씩 증여",
          totalTaxAtHorizon: "569,476,598원",
          totalTax: "382,753,687원",
          familyReceives: "4,327,544,239원",
          recommended: false,
        },
      ],
      href: "/estate?tab=compare",
    };
    const { container } = renderCard(card);
    expect(screen.getByText("2066.10.16에 상속한다고 가정했어요.")).toBeInTheDocument();

    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    const lines = (item: Element) =>
      Array.from(item.querySelectorAll("dt")).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(lines(items[0])).toEqual([
      ["가족에게 남는 금액", "4,413,922,523원"],
      ["총 세금(상속 시점 기준)", "483,098,314원"],
      ["총 세금(낸 금액)", "483,098,314원"],
    ]);
    expect(lines(items[1])).toEqual([
      ["가족에게 남는 금액", "4,327,544,239원"],
      ["총 세금(상속 시점 기준)", "569,476,598원"],
      ["총 세금(낸 금액)", "382,753,687원"],
    ]);

    const recommended = container.querySelectorAll('[data-recommended="true"]');
    expect(recommended).toHaveLength(1);
    expect(within(recommended[0] as HTMLElement).getByText("자녀에게 10년마다 공제 한도만큼 증여")).toBeInTheDocument();
    expect(within(recommended[0] as HTMLElement).getByText("같은 가정에서 가장 많이 남는 방향")).toBeInTheDocument();
    expect(screen.getAllByText("같은 가정에서 가장 많이 남는 방향")).toHaveLength(1);
    expect(disclaimers(container)).toEqual(["tax"]);
    expect(screen.getByRole("link", { name: /방향 비교 자세히 보기/ })).toHaveAttribute("href", "/estate?tab=compare");
  });

  it("table: href가 있으면 자세히 보기 링크(내부 경로만)", () => {
    const table: TableCard = {
      type: "table",
      title: "보유 종목",
      columns: [{ key: "name", label: "종목" }],
      rows: [{ name: "삼성전자" }],
      href: "/journal",
    };
    renderCard(table);
    expect(screen.getByRole("link", { name: /자세히 보기/ })).toHaveAttribute("href", "/journal");
    const external = renderCard({ ...table, title: "외부", href: "https://example.com" });
    expect(within(external.container).queryByRole("link")).not.toBeInTheDocument();
    const none = renderCard({ ...table, title: "없음", href: undefined });
    expect(within(none.container).queryByRole("link")).not.toBeInTheDocument();
  });
});
