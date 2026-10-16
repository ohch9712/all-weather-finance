import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { getPositions, getStats } from "@/features/journal/api";
import { TradeDialog } from "@/features/journal/components/TradeDialog";
import type { Trade, TradeInput } from "@/features/journal/types";
import { apiUrl, renderWithProviders, server } from "../utils";

const roundedTrade: Trade = {
  id: "e164d7a0-a4ea-44d4-8fc7-371d40aaeb05",
  tradedOn: "2026-10-01", tradedTime: null, tradedAt: "2026-10-01T00:00:00Z", timeKnown: false,
  market: "US", currency: "USD", symbolCode: "AAPL", symbolName: "애플", side: "buy",
  quantity: "1000", price: "10.01", fee: "0.00", tax: "0.00", broker: null, accountLabel: null,
  source: "manual", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
};

describe("매매 부분 수정", () => {
  it.each([
    ["symbolName", "종목명", "애플 수정"],
    ["accountLabel", "계좌 별칭", "장기 투자 계좌"],
  ] as const)("%s만 수정하면 소수 단가·수수료 원본과 보유·손익이 유지된다", async (field, label, value) => {
    let stored = { ...roundedTrade, price: "10.005", fee: "0.001" };
    let patch: Partial<TradeInput> | undefined;
    const position = () => {
      // 저장된 매수 1,000주 중 100주를 12달러에 매도한 가짜 서버 응답이다.
      const originalCost = Number(stored.quantity) * Number(stored.price) + Number(stored.fee);
      return {
        market: "US", symbolCode: "AAPL", symbolName: stored.symbolName, currency: "USD",
        quantity: "900", avgCost: (originalCost / 1000).toFixed(2),
        costBasis: (originalCost * 0.9).toFixed(2), realizedPnl: (1200 - originalCost * 0.1).toFixed(2),
        firstTradedOn: "2026-10-01", lastTradedOn: "2026-10-02", tradeCount: 2, hasOversold: false,
      };
    };
    server.use(
      http.patch(apiUrl(`/api/journal/trades/${roundedTrade.id}`), async ({ request }) => {
        patch = await request.json() as Partial<TradeInput>;
        stored = { ...stored, ...patch };
        return HttpResponse.json({ ...stored, price: Number(stored.price).toFixed(2), fee: Number(stored.fee).toFixed(2) });
      }),
      http.get(apiUrl("/api/journal/positions"), () => HttpResponse.json({ items: [position()] })),
      http.get(apiUrl("/api/journal/stats"), () => HttpResponse.json({
        byCurrency: [{ currency: "USD", realizedPnl: position().realizedPnl }], monthly: [], daily: [], bySymbol: [],
      })),
    );
    const before = (await getPositions(false)).items[0];
    const statsBefore = await getStats({});
    const { user } = renderWithProviders(<TradeDialog trade={roundedTrade} onClose={() => {}} />);
    await user.clear(screen.getByLabelText(label));
    await user.type(screen.getByLabelText(label), value);
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("매매 기록을 저장했어요.");
    expect(patch).toEqual({ [field]: value });
    expect(stored.price).toBe("10.005");
    expect(stored.fee).toBe("0.001");
    const after = (await getPositions(false)).items[0];
    expect(after.quantity).toBe(before.quantity);
    expect(after.avgCost).toBe(before.avgCost);
    expect(after.costBasis).toBe("9004.50");
    expect(after.costBasis).toBe(before.costBasis);
    expect(after.realizedPnl).toBe("199.50");
    expect(after.realizedPnl).toBe(before.realizedPnl);
    expect(await getStats({})).toEqual(statsBefore);
  });

  it("바꾼 금액 필드만 새 값으로 보낸다", async () => {
    let patch: Partial<TradeInput> | undefined;
    server.use(http.patch(apiUrl(`/api/journal/trades/${roundedTrade.id}`), async ({ request }) => {
      patch = await request.json() as Partial<TradeInput>;
      return HttpResponse.json({ ...roundedTrade, ...patch });
    }));
    const { user } = renderWithProviders(<TradeDialog trade={roundedTrade} onClose={() => {}} />);
    for (const [label, value] of [["단가", "10.007"], ["수수료", "0.003"], ["세금", "0.002"], ["수량", "1001"]]) {
      await user.clear(screen.getByLabelText(label));
      await user.type(screen.getByLabelText(label), value);
    }
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("매매 기록을 저장했어요.");
    expect(patch).toEqual({ price: "10.007", fee: "0.003", tax: "0.002", quantity: "1001" });
  });

  it("시장 변경으로 자동 설정된 통화를 함께 보내고 나머지 금액은 생략한다", async () => {
    let patch: Partial<TradeInput> | undefined;
    server.use(http.patch(apiUrl(`/api/journal/trades/${roundedTrade.id}`), async ({ request }) => {
      patch = await request.json() as Partial<TradeInput>;
      return HttpResponse.json({ ...roundedTrade, ...patch });
    }));
    const { user } = renderWithProviders(<TradeDialog trade={roundedTrade} onClose={() => {}} />);
    await user.selectOptions(screen.getByLabelText("시장"), "KRX");
    expect(screen.getByLabelText("통화")).toHaveValue("KRW");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("매매 기록을 저장했어요.");
    expect(patch).toEqual({ market: "KRX", currency: "KRW" });
  });

  it("입력 후 원래 값으로 되돌린 금액 필드는 보내지 않는다", async () => {
    let patch: Partial<TradeInput> | undefined;
    server.use(http.patch(apiUrl(`/api/journal/trades/${roundedTrade.id}`), async ({ request }) => {
      patch = await request.json() as Partial<TradeInput>;
      return HttpResponse.json({ ...roundedTrade, ...patch });
    }));
    const { user } = renderWithProviders(<TradeDialog trade={roundedTrade} onClose={() => {}} />);
    await user.clear(screen.getByLabelText("단가"));
    await user.type(screen.getByLabelText("단가"), "11");
    await user.clear(screen.getByLabelText("단가"));
    await user.type(screen.getByLabelText("단가"), roundedTrade.price);
    await user.type(screen.getByLabelText("계좌 별칭"), "장기 계좌");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("매매 기록을 저장했어요.");
    expect(patch).toEqual({ accountLabel: "장기 계좌" });
  });
});
