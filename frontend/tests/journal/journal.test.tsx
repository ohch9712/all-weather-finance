import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { JournalPage } from "@/features/journal/components/JournalPage";
import { TradeDetailPage } from "@/features/journal/components/TradeDetailPage";
import { NoteDialog } from "@/features/journal/components/NoteDialog";
import { TradeDialog } from "@/features/journal/components/TradeDialog";
import { PnlCalendar } from "@/features/journal/components/JournalStats";
import type { Note, Trade, TradeInput, TradeStats } from "@/features/journal/types";
import { todayKst, tradeAmount } from "@/features/journal/utils";
import { apiUrl, renderWithProviders, server } from "../utils";

// 매매일지 머리의 "증권사 동기화" 버튼이 연결 목록을 미리 불러온다.
beforeEach(() => { server.use(http.get(apiUrl("/api/market/connections"), () => HttpResponse.json({ items: [] }))); });

const trade: Trade = {
  id: "a1e524ad-b1bf-47b3-9d2d-873f91af63fe", tradedOn: "2026-09-03", tradedTime: "10:32", market: "KRX", currency: "KRW",
  symbolCode: "005930", symbolName: "삼성전자", side: "sell", quantity: "5", price: "90000", fee: "100", tax: "810", broker: "kiwoom", accountLabel: null,
  tradedAt: "2026-09-03T01:32:00Z", timeKnown: true, source: "manual", costEstimated: false, createdAt: "2026-09-03T01:32:00Z", updatedAt: "2026-09-03T01:32:00Z",
};
const stats: TradeStats = {
  byCurrency: [{ currency: "KRW", realizedPnl: "74040", winCount: 1, lossCount: 0, winRate: 100, sellCount: 1, avgWin: "74040", avgLoss: null, bestTrade: { tradeId: trade.id, symbolName: "삼성전자", realizedPnl: "74040", tradedOn: trade.tradedOn }, worstTrade: null }],
  monthly: [{ month: "2026-09", currency: "KRW", realizedPnl: "74040" }], daily: [{ date: "2026-09-03", currency: "KRW", realizedPnl: "74040" }, { date: "2026-09-04", currency: "KRW", realizedPnl: "-225150" }],
  bySymbol: [{ symbolCode: "005930", symbolName: "삼성전자", currency: "KRW", realizedPnl: "74040", sellCount: 1 }],
};
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 20, total: items.length });
function mockTrades() { server.use(http.get(apiUrl("/api/journal/trades"), () => HttpResponse.json(page([trade])))); }

async function fillTrade(user: ReturnType<typeof renderWithProviders>["user"]) {
  await user.type(screen.getByLabelText("종목코드"), "AAPL");
  await user.type(screen.getByLabelText("종목명"), "애플");
  await user.type(screen.getByLabelText("수량"), "0.5");
  await user.type(screen.getByLabelText("단가"), "10.01");
}

describe("매매일지", () => {
  it("매매 추가에서 시장을 바꾸면 통화를 자동 설정하고 저장 후 노트 연결을 안내한다", async () => {
    let received: TradeInput | undefined;
    server.use(http.post(apiUrl("/api/journal/trades"), async ({ request }) => { received = await request.json() as TradeInput; return HttpResponse.json({ ...trade, ...received }, { status: 201 }); }));
    const { user } = renderWithProviders(<TradeDialog onClose={() => {}} />);
    await user.selectOptions(screen.getByLabelText("시장"), "US");
    expect(screen.getByLabelText("통화")).toHaveValue("USD");
    await fillTrade(user);
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("link", { name: "이 거래에 노트 남기기" })).toHaveAttribute("href", `/journal/${trade.id}`);
    expect(received).toMatchObject({ market: "US", currency: "USD", quantity: "0.5", price: "10.01", tradedTime: null });
  });

  it("매매를 수정하고 삭제하면 목록으로 이동한다", async () => {
    let updated = trade;
    let deleted = false;
    server.use(
      http.get(apiUrl(`/api/journal/trades/${trade.id}`), () => HttpResponse.json({ trade: updated, realizedPnl: "74040", oversold: true, notes: [] })),
      http.patch(apiUrl(`/api/journal/trades/${trade.id}`), async ({ request }) => { updated = { ...trade, ...await request.json() as TradeInput }; return HttpResponse.json(updated); }),
      http.delete(apiUrl(`/api/journal/trades/${trade.id}`), () => { deleted = true; return new HttpResponse(null, { status: 204 }); }),
    );
    const { user, router } = renderWithProviders(<TradeDetailPage id={trade.id} />);
    expect(await screen.findByText(/보유보다 많이 매도/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "매매 수정" }));
    await user.clear(screen.getByLabelText("단가")); await user.type(screen.getByLabelText("단가"), "91000");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("매매 기록을 저장했어요.");
    expect(updated.price).toBe("91000");
    await user.click(screen.getByRole("button", { name: "완료" }));
    await user.click(screen.getByRole("button", { name: "매매 삭제" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "매매 삭제" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/journal"));
    expect(deleted).toBe(true);
  });

  it("보유 탭을 URL에 반영하고 경고와 이동평균 수치를 보여 준다", async () => {
    mockTrades();
    server.use(http.get(apiUrl("/api/journal/positions"), () => HttpResponse.json({ items: [{ market: "KRX", symbolCode: "005930", symbolName: "삼성전자", currency: "KRW", quantity: "15", avgCost: "75010", costBasis: "1125150", realizedPnl: "74040", firstTradedOn: "2026-09-01", lastTradedOn: "2026-09-03", tradeCount: 3, hasOversold: true }] })));
    const { user, router } = renderWithProviders(<JournalPage />);
    await user.click(screen.getByRole("tab", { name: "보유" }));
    await screen.findByText("75,010원");
    expect(screen.getByText("1,125,150원")).toBeInTheDocument();
    expect(screen.getByText(/기록이 빠진 매수가/)).toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith("/journal?tab=positions", { scroll: false });
  });

  it("통계 요약과 달력의 수익·손실 색 및 부호를 구분한다", async () => {
    server.use(http.get(apiUrl("/api/journal/stats"), () => HttpResponse.json(stats)));
    renderWithProviders(<JournalPage />, { route: "/journal?tab=stats" });
    await screen.findByText("100%");
    fireEvent.change(screen.getByLabelText("달력 월"), { target: { value: "2026-09" } });
    const profit = screen.getByRole("gridcell", { name: "2026-09-03 74,040원" });
    const loss = screen.getByRole("gridcell", { name: "2026-09-04 -225,150원" });
    expect(profit).toHaveAttribute("data-pnl", "profit"); expect(loss).toHaveAttribute("data-pnl", "loss");
    expect(profit.getAttribute("style")).toContain("--money-up"); expect(loss.getAttribute("style")).toContain("--money-down");
    expect(within(profit).getByText("+")).toHaveClass("text-money-up");
    expect(within(loss).getByText("−")).toHaveClass("text-money-down");
  });

  it("노트를 추가하고 거래에 연결하며 한국어 감정을 보여 준다", async () => {
    mockTrades();
    const notes: Note[] = [];
    server.use(
      http.get(apiUrl("/api/journal/notes"), () => HttpResponse.json(page(notes))),
      http.post(apiUrl("/api/journal/notes"), async ({ request }) => { const note = { ...await request.json() as Note, id: "note1", createdAt: trade.createdAt, updatedAt: trade.updatedAt }; notes.push(note); return HttpResponse.json(note, { status: 201 }); }),
    );
    const { user } = renderWithProviders(<JournalPage />, { route: "/journal?tab=notes" });
    await user.click(screen.getByRole("button", { name: "노트 추가" }));
    await screen.findByRole("option", { name: /삼성전자/ });
    await user.type(screen.getByLabelText("내용"), "매수 이유를 복기합니다.");
    await user.type(screen.getByLabelText("태그 (쉼표로 구분)"), "복기, 장기, 복기");
    await user.selectOptions(screen.getByLabelText("감정"), "calm");
    await user.selectOptions(screen.getByLabelText("연결 거래"), trade.id);
    await user.click(screen.getByRole("button", { name: "노트 저장" }));
    await screen.findByText("매수 이유를 복기합니다.");
    expect(screen.getByText("차분")).toBeInTheDocument();
    expect(notes[0].tradeId).toBe(trade.id); expect(notes[0].tags).toEqual(["복기", "장기"]);
    expect(screen.getByRole("link", { name: "연결 거래 보기" })).toHaveAttribute("href", `/journal/${trade.id}`);
  });

  it("상세에서 연 노트는 거래 목록이 도착해도 선택한 거래를 유지한다", async () => {
    mockTrades();
    let received: Note | undefined;
    server.use(http.post(apiUrl("/api/journal/notes"), async ({ request }) => {
      received = await request.json() as Note;
      return HttpResponse.json({ ...received, id: "linked-note", createdAt: trade.createdAt, updatedAt: trade.updatedAt }, { status: 201 });
    }));
    const { user } = renderWithProviders(<NoteDialog tradeId={trade.id} symbolCode={trade.symbolCode} onClose={() => {}} />);
    await screen.findByRole("option", { name: /삼성전자/ });
    expect(screen.getByLabelText("연결 거래")).toHaveValue(trade.id);
    await user.type(screen.getByLabelText("내용"), "이 거래 복기");
    await user.click(screen.getByRole("button", { name: "노트 저장" }));
    await waitFor(() => expect(received?.tradeId).toBe(trade.id));
  });

  it("잘못된 매매 입력은 API에 보내지 않고 필드 오류를 보여 준다", async () => {
    const { user } = renderWithProviders(<TradeDialog onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("종목명을 입력해 주세요.")).toBeInTheDocument();
  });

  it("달력은 현재 KST 월과 요일 격자를 보여 준다", () => {
    renderWithProviders(<PnlCalendar daily={[]} currency="USD" />);
    expect(screen.getByLabelText("달력 월")).toHaveValue(todayKst().slice(0, 7));
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  });

  it("거래 금액은 부동소수점 오차 없이 통화 단위로 반올림한다", () => {
    expect(tradeAmount("0.5", "10.01", "USD")).toBe("5.01");
    expect(tradeAmount("10", "70000", "KRW")).toBe("700000");
    expect(tradeAmount("0.000001", "0.000001", "USD")).toBe("0.00");
  });
});
