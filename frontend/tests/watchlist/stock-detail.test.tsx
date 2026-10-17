import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { StockDetailPage } from "@/features/stocks/components/StockDetailPage";
import { periodRange } from "@/features/stocks/utils";
import { authPayload, renderWithProviders } from "../utils";
import { mockApi, stockDetail, watchlistItem } from "./fake-api";

function renderDetail(code: string) {
  return renderWithProviders(
    <>
      <StockDetailPage code={code} />
      <Toaster />
    </>,
    { route: `/stocks/${code}`, auth: authPayload() },
  );
}

function metric(label: string) {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling as HTMLElement;
}

describe("종목 상세 화면", () => {
  it("머리: 종목명·코드·시장·업종·현재가와 등락·샘플 배지·매매 기록 링크·고지", async () => {
    mockApi([]);
    renderDetail("005930");
    expect(await screen.findByRole("heading", { level: 1, name: "삼성전자" })).toBeInTheDocument();
    expect(screen.getByText("005930 · KOSPI · 통신 및 방송 장비 제조업")).toBeInTheDocument();
    expect(screen.getByText("102,800원")).toBeInTheDocument();
    const change = screen.getByText("-1.21%").closest("[data-tone]");
    expect(change).toHaveAttribute("data-tone", "down");
    expect(change).toHaveTextContent("-1,260원");
    expect(screen.queryByText("ETF")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^샘플 데이터/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "내 매매 기록 보기" })).toHaveAttribute(
      "href",
      "/journal?tab=records&symbol=005930",
    );
    expect(screen.getAllByRole("note").map((note) => note.getAttribute("data-variant"))).toEqual(["investment"]);
  });

  it("차트: 기본 3개월, 기간 버튼으로 바꾸면 그 기간의 캔들을 요청한다", async () => {
    const api = mockApi([]);
    const { user } = renderDetail("005930");
    expect(await screen.findByRole("img", { name: "삼성전자 종가 추이(3개월)" })).toBeInTheDocument();
    expect(api.candleRequests).toEqual([{ code: "005930", ...periodRange("3m") }]);
    expect(screen.getByRole("button", { name: "3개월" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "1년" }));
    expect(await screen.findByRole("img", { name: "삼성전자 종가 추이(1년)" })).toBeInTheDocument();
    expect(api.candleRequests.at(-1)).toEqual({ code: "005930", ...periodRange("1y") });
    expect(screen.getByRole("button", { name: "1년" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "1개월" }));
    await waitFor(() => expect(api.candleRequests.at(-1)).toEqual({ code: "005930", ...periodRange("1m") }));
    await user.click(screen.getByRole("button", { name: "6개월" }));
    await waitFor(() => expect(api.candleRequests.at(-1)).toEqual({ code: "005930", ...periodRange("6m") }));
  });

  it("차트 데이터가 없으면 안내한다", async () => {
    mockApi([], { candles: () => [] });
    renderDetail("005930");
    expect(await screen.findByText("이 기간의 차트 데이터가 없어요.")).toBeInTheDocument();
  });

  it("지표 격자: 값 형식과 용어 설명 링크(07 slug)", async () => {
    mockApi([]);
    renderDetail("005930");
    await screen.findByRole("heading", { level: 1, name: "삼성전자" });
    expect(metric("PER")).toHaveTextContent("31.86배");
    expect(metric("PBR")).toHaveTextContent("0.74배");
    expect(metric("ROE")).toHaveTextContent("-1.52%");
    expect(metric("EPS")).toHaveTextContent("1,221원");
    expect(metric("BPS")).toHaveTextContent("33,432원");
    expect(metric("시가총액")).toHaveTextContent("12,756억원");
    expect(metric("52주 최고")).toHaveTextContent("123,360원");
    expect(metric("52주 최저")).toHaveTextContent("82,240원");
    expect(metric("외국인 비율")).toHaveTextContent("41.48%");
    expect(metric("거래대금")).toHaveTextContent("2,189.1억원");

    const links = {
      PER: "/learn/per",
      PBR: "/learn/pbr",
      ROE: "/learn/roe",
      EPS: "/learn/eps",
      시가총액: "/learn/market-cap",
    };
    for (const [label, href] of Object.entries(links)) {
      expect(screen.getByRole("link", { name: `${label} 용어 설명` })).toHaveAttribute("href", href);
    }
    expect(screen.queryByRole("link", { name: "BPS 용어 설명" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ETF란?" })).not.toBeInTheDocument();
  });

  it("값이 없는 지표는 —로 보인다", async () => {
    const base = stockDetail("005930");
    mockApi([], {
      details: {
        "005930": {
          ...base,
          snapshot: { ...base.snapshot!, per: null, marketCap: null, foreignRatio: null, tradingValue: null },
        },
      },
    });
    renderDetail("005930");
    await screen.findByRole("heading", { level: 1, name: "삼성전자" });
    for (const label of ["PER", "시가총액", "외국인 비율", "거래대금"]) {
      expect(metric(label)).toHaveTextContent("—");
    }
    expect(metric("PBR")).toHaveTextContent("0.74배");
  });

  it("ETF: 배지, 재무지표 —, 재무지표 '?' 대신 'ETF란?' 링크", async () => {
    mockApi([]);
    renderDetail("069500");
    expect(await screen.findByRole("heading", { level: 1, name: "KODEX 200" })).toBeInTheDocument();
    expect(screen.getByText("ETF")).toBeInTheDocument();
    for (const label of ["PER", "PBR", "ROE", "EPS", "BPS", "외국인 비율"]) {
      expect(metric(label)).toHaveTextContent("—");
    }
    expect(screen.getByRole("link", { name: "ETF란?" })).toHaveAttribute("href", "/learn/etf");
    for (const label of ["PER", "PBR", "ROE", "EPS"]) {
      expect(screen.queryByRole("link", { name: `${label} 용어 설명` })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "내 매매 기록 보기" })).toHaveAttribute(
      "href",
      "/journal?tab=records&symbol=069500",
    );
  });

  it("관심종목 담기·빼기 토글", async () => {
    const api = mockApi([watchlistItem("000660")]);
    const { user } = renderDetail("005930");
    const add = await screen.findByRole("button", { name: "관심종목 담기" });
    await waitFor(() => expect(add).toBeEnabled());
    expect(add).toHaveAttribute("aria-pressed", "false");

    await user.click(add);
    await waitFor(() => expect(api.posts).toEqual([{ code: "005930", groupName: "기본", memo: null }]));
    const remove = await screen.findByRole("button", { name: "관심종목에서 빼기" });
    expect(remove).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("관심종목에 담았어요.")).toBeInTheDocument();

    await waitFor(() => expect(remove).toBeEnabled());
    await user.click(remove);
    await waitFor(() => expect(api.deletes).toHaveLength(1));
    expect(await screen.findByRole("button", { name: "관심종목 담기" })).toBeInTheDocument();
    expect(api.items.map((item) => item.code)).toEqual(["000660"]);
  });

  it("이미 담긴 종목은 빼기 상태로 시작한다", async () => {
    const item = watchlistItem("005930");
    const api = mockApi([item]);
    const { user } = renderDetail("005930");
    const remove = await screen.findByRole("button", { name: "관심종목에서 빼기" });
    await user.click(remove);
    await waitFor(() => expect(api.deletes).toEqual([item.id]));
  });

  it("없는 코드는 404 화면", async () => {
    mockApi([]);
    renderDetail("999999");
    expect(await screen.findByText("종목을 찾을 수 없어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "관심종목으로" })).toHaveAttribute("href", "/stocks/watchlist");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(within(document.body).queryByRole("button", { name: "관심종목 담기" })).not.toBeInTheDocument();
  });
});
