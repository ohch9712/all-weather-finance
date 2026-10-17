import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { TradingCostsPage } from "@/features/journal/components/TradingCostsPage";
import { TradeDialog } from "@/features/journal/components/TradeDialog";
import { JournalPage } from "@/features/journal/components/JournalPage";
import { TradeDetailPage } from "@/features/journal/components/TradeDetailPage";
import type { CostSettings, Trade } from "@/features/journal/types";
import { apiUrl, renderWithProviders, server } from "../utils";

const defaults: CostSettings = { krxCommissionRate: "0.015", krxSellTaxRate: "0.20", usCommissionRate: "0.25", isDefault: true, updatedAt: null };
const trade: Trade = {
  id: "cost-trade", tradedOn: "2026-09-01", tradedTime: null, tradedAt: "2026-09-01T00:00:00Z", timeKnown: false,
  market: "KRX", currency: "KRW", symbolCode: "005930", symbolName: "삼성전자", side: "sell", quantity: "10", price: "70000", fee: "105", tax: "1400",
  broker: null, accountLabel: null, source: "manual", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", costEstimated: true,
};
function fill() {
  for (const [label, value] of [["종목코드", "005930"], ["종목명", "삼성전자"], ["수량", "10"], ["단가", "70000"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}
function estimateHandler() {
  server.use(http.get(apiUrl("/api/journal/cost-estimate"), ({ request }) => {
    const params = new URL(request.url).searchParams;
    return HttpResponse.json({ fee: params.get("price") === "80000" ? "120" : "105", tax: params.get("side") === "sell" ? "1400" : "0", isEtf: false, rates: defaults });
  }));
}

describe("매매 비용 설정과 추정", () => {
  it("설정을 저장하고 확인 창을 거쳐 기본값으로 되돌린다", async () => {
    let settings = defaults;
    server.use(
      http.get(apiUrl("/api/journal/cost-settings"), () => HttpResponse.json(settings)),
      http.put(apiUrl("/api/journal/cost-settings"), async ({ request }) => {
        settings = { ...settings, ...await request.json() as CostSettings, isDefault: false, updatedAt: "2026-10-17T00:00:00Z" };
        return HttpResponse.json(settings);
      }),
      http.delete(apiUrl("/api/journal/cost-settings"), () => { settings = defaults; return HttpResponse.json(settings); }),
    );
    const { user } = renderWithProviders(<TradingCostsPage />);
    const input = await screen.findByLabelText("국내주식 매매수수료 (%)");
    expect(input).toHaveValue(0.015);
    expect(screen.getByLabelText("국내주식 매도 거래세 (%)")).toHaveValue(0.2);
    expect(screen.getByLabelText("미국주식 매매수수료 (%)")).toHaveValue(0.25);
    await user.clear(input); await user.type(input, "0.1");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("직접 설정한 요율을 사용하고 있어요.");
    expect(settings.krxCommissionRate).toBe("0.1");
    await user.click(screen.getByRole("button", { name: "기본값으로 되돌리기" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "되돌리기" }));
    await waitFor(() => expect(screen.getByLabelText("국내주식 매매수수료 (%)")).toHaveValue(0.015));
    expect(screen.getByText("국내 ETF는 팔 때 거래세가 붙지 않아요.")).toBeInTheDocument();
  });

  it("요율 범위와 소수 자릿수를 검증한다", async () => {
    server.use(http.get(apiUrl("/api/journal/cost-settings"), () => HttpResponse.json(defaults)));
    const { user } = renderWithProviders(<TradingCostsPage />);
    fireEvent.change(await screen.findByLabelText("국내주식 매매수수료 (%)"), { target: { value: "5.1" } });
    fireEvent.change(screen.getByLabelText("미국주식 매매수수료 (%)"), { target: { value: "0.00001" } });
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("요율은 0~5%로 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("소수 넷째 자리까지 입력해 주세요.")).toBeInTheDocument();
  });

  it("300ms 후 초기 추정치를 채우고 직접 고친 비용은 입력 변경 후에도 보존하며 명시한다", async () => {
    estimateHandler();
    let received: Record<string, unknown> | undefined;
    server.use(http.post(apiUrl("/api/journal/trades"), async ({ request }) => {
      received = await request.json() as Record<string, unknown>;
      return HttpResponse.json(trade, { status: 201 });
    }));
    const { user } = renderWithProviders(<TradeDialog onClose={() => {}} />);
    fill();
    expect(screen.getByLabelText("수수료")).toHaveValue(0);
    await waitFor(() => expect(screen.getByLabelText("수수료")).toHaveValue(105));
    fireEvent.change(screen.getByLabelText("수수료"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("세금"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("세금"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("단가"), { target: { value: "80000" } });
    await user.selectOptions(screen.getByLabelText("매매 구분"), "sell");
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(screen.getByLabelText("수수료")).toHaveValue(7);
    expect(screen.getByLabelText("세금")).toHaveValue(0);
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("매매 기록을 저장했어요.");
    expect(received).toMatchObject({ fee: "7", tax: "0" });
  });

  it.each([false, true])("직접 고치지 않은 비용은 생략한다 (수수료 직접 수정: %s)", async (manualFee) => {
    estimateHandler();
    let received: Record<string, unknown> | undefined;
    server.use(http.post(apiUrl("/api/journal/trades"), async ({ request }) => { received = await request.json() as Record<string, unknown>; return HttpResponse.json(trade, { status: 201 }); }));
    const { user } = renderWithProviders(<TradeDialog onClose={() => {}} />);
    fill();
    await waitFor(() => expect(screen.getByLabelText("수수료")).toHaveValue(105));
    if (manualFee) fireEvent.change(screen.getByLabelText("수수료"), { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("매매 기록을 저장했어요.");
    if (manualFee) expect(received?.fee).toBe("0"); else expect(received).not.toHaveProperty("fee");
    expect(received).not.toHaveProperty("tax");
  });

  it("늦게 도착한 이전 추정 응답이 최신 입력의 추정치를 덮어쓰지 않는다", async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const requested: string[] = [];
    server.use(http.get(apiUrl("/api/journal/cost-estimate"), async ({ request }) => {
      const price = new URL(request.url).searchParams.get("price")!;
      requested.push(price);
      if (price === "70000") await blocked;
      return HttpResponse.json({ fee: price === "80000" ? "120" : "105", tax: "0", isEtf: false, rates: defaults });
    }));
    renderWithProviders(<TradeDialog onClose={() => {}} />);
    fill();
    await waitFor(() => expect(requested).toContain("70000"));
    fireEvent.change(screen.getByLabelText("단가"), { target: { value: "80000" } });
    await waitFor(() => expect(screen.getByLabelText("수수료")).toHaveValue(120));
    release();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(screen.getByLabelText("수수료")).toHaveValue(120);
  });

  it("URL의 종목을 초기 필터로 적용하고 바꾼 종목을 쿼리에 반영한다", async () => {
    const requests: string[] = [];
    server.use(http.get(apiUrl("/api/journal/trades"), ({ request }) => {
      requests.push(new URL(request.url).searchParams.get("symbol") ?? "");
      return HttpResponse.json({ items: [trade], total: 1, page: 1, pageSize: 20 });
    }));
    const { router } = renderWithProviders(<JournalPage />, { route: "/journal?tab=records&symbol=005930" });
    await screen.findAllByText("삼성전자");
    expect(screen.getByLabelText("종목 검색")).toHaveValue("005930");
    expect(requests[0]).toBe("005930"); expect(screen.getAllByText("추정")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("종목 검색"), { target: { value: "AAPL" } });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/journal?tab=records&symbol=AAPL", { scroll: false }));
    await waitFor(() => expect(requests).toContain("AAPL"));
  });

  it("거래 상세에 추정 배지를 표시한다", async () => {
    server.use(http.get(apiUrl(`/api/journal/trades/${trade.id}`), () => HttpResponse.json({ trade, realizedPnl: null, oversold: false, notes: [] })));
    renderWithProviders(<TradeDetailPage id={trade.id} />);
    expect(await screen.findByText("추정")).toBeInTheDocument();
  });
});
