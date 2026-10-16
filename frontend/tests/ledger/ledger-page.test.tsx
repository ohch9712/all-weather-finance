import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LedgerRoute from "@/app/(app)/ledger/page";
import { renderWithProviders } from "../utils";
import { OCTOBER_SEED, mockLedger, type SeedEntry } from "./mock-ledger";

function renderLedger(route = "/ledger?month=2026-10") {
  return renderWithProviders(<LedgerRoute />, { route });
}

/** 내역 목록 영역 */
function entriesRegion() {
  return screen.getByRole("region", { name: "내역" });
}

function findEntryRow(name: string) {
  return within(entriesRegion()).findByRole("button", { name: new RegExp(name) });
}

function queryEntryRow(name: string) {
  return within(entriesRegion()).queryByRole("button", { name: new RegExp(name) });
}

function card(title: string) {
  return screen.getByText(title, { selector: "[data-slot=card-title]" }).closest("[data-slot=card]") as HTMLElement;
}

describe("가계부 화면", () => {
  it("요약 카드 4개와 차트·자주 쓴 곳을 보여 준다", async () => {
    mockLedger(OCTOBER_SEED);
    renderLedger();

    expect(await screen.findByRole("heading", { level: 1, name: "가계부" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "2026년 10월" })).toBeInTheDocument();
    await waitFor(() => expect(within(card("수입")).getByText("3,500,000원")).toBeInTheDocument());
    expect(within(card("지출")).getByText("1,820,000원")).toBeInTheDocument();
    expect(within(card("순수입")).getByText("+1,680,000원")).toBeInTheDocument();
    const change = card("전월 대비 지출");
    expect(within(change).getByText("-9.45%")).toBeInTheDocument();
    expect(within(change).getByText("지난달보다 190,000원 아꼈어요")).toBeInTheDocument();

    expect(screen.getByRole("img", { name: "2026년 10월 지출 카테고리 비중" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "2026년 10월 일별 지출" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "2026년 5월부터 2026년 10월까지 수입·지출" })).toBeInTheDocument();
    // 도넛 범례: 금액 순 지출 카테고리
    const donutTable = screen.getByRole("table", { name: "2026년 10월 지출 카테고리 비중" });
    expect(within(donutTable).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
      "주거·관리비",
      "식비",
      "쇼핑",
      "교통",
    ]);

    const merchants = within(screen.getByRole("list", { name: "자주 쓴 곳" })).getAllByRole("listitem");
    expect(merchants.map((item) => item.textContent)).toEqual([
      "1관리사무소1건800,000원",
      "2마트1건520,000원",
      "3쿠팡1건400,000원",
    ]);
  });

  it("전월 지출이 없으면 증감률 대신 안내를 보여 준다", async () => {
    mockLedger([{ occurredOn: "2026-10-03", amount: 5_000, category: "식비" }]);
    renderLedger();
    await waitFor(() => expect(within(card("전월 대비 지출")).getByText("지난달 지출 기록이 없어요")).toBeInTheDocument());
    expect(within(card("전월 대비 지출")).getByText("-")).toBeInTheDocument();
  });

  it("지난달보다 많이 쓰면 '더 썼어요'를 보여 준다", async () => {
    mockLedger([
      { occurredOn: "2026-09-03", amount: 10_000, category: "식비" },
      { occurredOn: "2026-10-03", amount: 15_000, category: "식비" },
    ]);
    renderLedger();
    await waitFor(() => expect(within(card("전월 대비 지출")).getByText("+50.00%")).toBeInTheDocument());
    expect(within(card("전월 대비 지출")).getByText("지난달보다 5,000원 더 썼어요")).toBeInTheDocument();
  });

  it("월을 옮기면 URL과 요약·목록 요청의 달이 바뀐다", async () => {
    const ledger = mockLedger(OCTOBER_SEED);
    const { user, router } = renderLedger();
    await findEntryRow("관리사무소");

    await user.click(screen.getByRole("button", { name: "이전 달" }));
    expect(router.replace).toHaveBeenLastCalledWith("/ledger?month=2026-09", { scroll: false });
    expect(await screen.findByRole("heading", { level: 2, name: "2026년 9월" })).toBeInTheDocument();
    await waitFor(() => expect(ledger.requests).toContain("GET /api/ledger/summary?month=2026-09"));
    expect(ledger.requests.some((request) => request.startsWith("GET /api/ledger/entries?month=2026-09&"))).toBe(true);
    await waitFor(() => expect(within(card("지출")).getByText("2,010,000원")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "다음 달" }));
    await user.click(screen.getByRole("button", { name: "다음 달" }));
    expect(router.replace).toHaveBeenLastCalledWith("/ledger?month=2026-11", { scroll: false });
    await waitFor(() => expect(ledger.requests).toContain("GET /api/ledger/summary?month=2026-11"));
    expect(await screen.findByText("이 달의 내역이 없어요")).toBeInTheDocument();
  });

  it("종류 탭·카테고리·검색어를 URL 쿼리에 반영한다", async () => {
    const ledger = mockLedger(OCTOBER_SEED);
    const { user, router } = renderLedger();
    await findEntryRow("관리사무소");

    await user.click(screen.getByRole("tab", { name: "수입" }));
    expect(router.replace).toHaveBeenLastCalledWith("/ledger?month=2026-10&kind=income", { scroll: false });
    await waitFor(() => expect(queryEntryRow("관리사무소")).not.toBeInTheDocument());
    expect(ledger.requests).toContain("GET /api/ledger/entries?month=2026-10&kind=income&page=1&pageSize=20");

    await user.click(screen.getByRole("combobox", { name: "카테고리" }));
    // 수입 탭에서는 수입 카테고리만 고를 수 있다.
    expect(screen.queryByRole("option", { name: "식비" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "급여" }));
    expect(router.replace).toHaveBeenLastCalledWith("/ledger?month=2026-10&kind=income&categoryId=cat-i1", { scroll: false });

    // 지출 탭으로 바꾸면 맞지 않는 카테고리 필터를 푼다.
    await user.click(screen.getByRole("tab", { name: "지출" }));
    expect(router.replace).toHaveBeenLastCalledWith("/ledger?month=2026-10&kind=expense", { scroll: false });

    await user.type(screen.getByRole("searchbox", { name: "사용처·메모 검색" }), " 마트 ");
    await waitFor(() =>
      expect(router.replace).toHaveBeenLastCalledWith("/ledger?month=2026-10&kind=expense&q=%EB%A7%88%ED%8A%B8", { scroll: false }),
    );
    // 디바운스: 글자마다 URL을 바꾸지 않는다.
    expect(router.replace.mock.calls.filter(([href]) => href.includes("q="))).toHaveLength(1);
    await waitFor(() =>
      expect(ledger.requests).toContain(
        "GET /api/ledger/entries?month=2026-10&kind=expense&q=%EB%A7%88%ED%8A%B8&page=1&pageSize=20",
      ),
    );
    expect(await findEntryRow("마트")).toBeInTheDocument();
    expect(queryEntryRow("쿠팡")).not.toBeInTheDocument();
  });

  it("URL 쿼리의 필터로 시작한다", async () => {
    const ledger = mockLedger(OCTOBER_SEED);
    renderLedger("/ledger?month=2026-10&kind=expense&categoryId=cat-e1&q=%EB%A7%88%ED%8A%B8");
    expect(await findEntryRow("마트")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "지출" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("searchbox", { name: "사용처·메모 검색" })).toHaveValue("마트");
    expect(screen.getByRole("combobox", { name: "카테고리" })).toHaveTextContent("식비");
    expect(ledger.requests).toContain(
      "GET /api/ledger/entries?month=2026-10&kind=expense&categoryId=cat-e1&q=%EB%A7%88%ED%8A%B8&page=1&pageSize=20",
    );
  });

  it("내역을 날짜별로 묶고 그날 합계, 수입 +·파란색, 지출 -, 출처 배지를 보여 준다", async () => {
    mockLedger(OCTOBER_SEED);
    renderLedger();
    const day25 = await screen.findByRole("region", { name: "10월 25일 (일)" });
    expect(within(day25).getByRole("heading", { name: "10월 25일 (일)" })).toBeInTheDocument();
    // 날짜 헤더의 그날 합계
    expect(within(day25).getAllByText("+3,500,000원")[0]).toHaveClass("text-money-down");
    const salary = within(day25).getByRole("button", { name: /회사/ });
    expect(within(salary).getByText("+3,000,000원")).toHaveClass("text-money-down");
    expect(within(salary).getByText("급여")).toBeInTheDocument();
    expect(within(salary).getByText("카드")).toBeInTheDocument();

    const day15 = screen.getByRole("region", { name: "10월 15일 (목)" });
    expect(within(day15).getByText("-920,000원")).toBeInTheDocument();
    const coupang = within(day15).getByRole("button", { name: /쿠팡/ });
    expect(within(coupang).getByText("-400,000원")).not.toHaveClass("text-money-down");
    expect(within(coupang).getByText("명세서")).toBeInTheDocument();
    expect(within(within(day15).getByRole("button", { name: /마트/ })).queryByText("명세서")).not.toBeInTheDocument();
    // 사용처가 없으면 메모를 제목으로 쓴다.
    expect(screen.getByText("교통카드 충전", { selector: "span.truncate" })).toBeInTheDocument();
    // 날짜는 최근 순
    expect(screen.getAllByRole("region", { name: /^10월/ }).map((region) => region.getAttribute("aria-label"))).toEqual([
      "10월 25일 (일)",
      "10월 15일 (목)",
      "10월 2일 (금)",
      "10월 1일 (목)",
    ]);
  });

  it("페이지 버튼으로 다음 쪽을 불러온다", async () => {
    const seed: SeedEntry[] = Array.from({ length: 25 }, (_, index) => ({
      occurredOn: `2026-10-${String((index % 28) + 1).padStart(2, "0")}`,
      amount: 1_000 + index,
      category: "식비",
      merchant: `가게${index + 1}`,
    }));
    const ledger = mockLedger(seed);
    const { user } = renderLedger();
    const nav = await screen.findByRole("navigation", { name: "내역 페이지" });
    expect(within(nav).getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("총 25건")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "이전" })).toBeDisabled();

    await user.click(within(nav).getByRole("button", { name: "다음" }));
    await waitFor(() => expect(within(nav).getByText("2 / 2")).toBeInTheDocument());
    expect(ledger.requests).toContain("GET /api/ledger/entries?month=2026-10&page=2&pageSize=20");
    expect(within(nav).getByRole("button", { name: "다음" })).toBeDisabled();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /가게/ })).toHaveLength(5));

    // 필터가 바뀌면 1쪽부터 다시 본다.
    await user.click(screen.getByRole("tab", { name: "지출" }));
    await waitFor(() =>
      expect(ledger.requests).toContain("GET /api/ledger/entries?month=2026-10&kind=expense&page=1&pageSize=20"),
    );
  });

  it("카드 명세서 가져오기 버튼은 /ledger/import로 간다", async () => {
    mockLedger();
    renderLedger();
    expect(await screen.findByRole("link", { name: "카드 명세서 가져오기" })).toHaveAttribute("href", "/ledger/import");
  });
});
