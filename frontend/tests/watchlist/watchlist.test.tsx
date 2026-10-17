import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { WatchlistPage } from "@/features/watchlist/components/WatchlistPage";
import { watchlistKey } from "@/features/watchlist/hooks";
import { authPayload, renderWithProviders } from "../utils";
import { mockApi, watchlistItem } from "./fake-api";

function renderPage() {
  return renderWithProviders(
    <>
      <WatchlistPage />
      <Toaster />
    </>,
    { route: "/stocks/watchlist", auth: authPayload() },
  );
}

/** 관심종목 행만(토스트 목록 항목 제외) */
function rows() {
  return screen.getAllByRole("listitem", { name: /\([0-9A-Z]+\)$/ });
}

function row(name: string) {
  return screen.getByRole("listitem", { name: new RegExp(`^${name}\\(`) });
}

describe("관심종목 화면", () => {
  it("비었으면 검색 안내와 조건검색 링크를 보여 주고 고지를 붙인다", async () => {
    mockApi([]);
    renderPage();
    expect(await screen.findByText("관심종목이 비어 있어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /조건검색으로 종목 찾기/ })).toHaveAttribute("href", "/stocks/screener");
    expect(screen.getAllByRole("note").map((note) => note.getAttribute("data-variant"))).toEqual(["investment"]);
    expect(screen.getByRole("button", { name: /그룹 관리/ })).toBeDisabled();
  });

  it("검색 콤보박스: 300ms 디바운스로 한 번 찾고, 시장·업종·ETF 배지를 보여 주고, 고르면 담는다", async () => {
    const api = mockApi([]);
    const { user } = renderPage();
    await screen.findByText("관심종목이 비어 있어요");

    const input = screen.getByRole("combobox", { name: "관심종목에 담을 종목 검색" });
    await user.type(input, "삼성");
    const option = await screen.findByRole("option", { name: /^삼성전자005930/ });
    // 글자마다 부르지 않고 입력이 멈춘 뒤 한 번만 찾는다.
    expect(api.searches).toEqual(["삼성"]);
    expect(option).toHaveTextContent("KOSPI · 통신 및 방송 장비 제조업");
    expect(screen.getByRole("option", { name: /삼성전자우/ })).toBeInTheDocument();

    await user.click(option);
    await waitFor(() => expect(api.posts).toEqual([{ code: "005930", groupName: "기본", memo: null }]));
    expect(await screen.findByRole("listitem", { name: "삼성전자(005930)" })).toBeInTheDocument();
    expect(input).toHaveValue("");

    // ETF 검색 결과에도 배지를 붙이고, 키보드로 골라 담을 수 있다.
    await user.type(input, "KODEX");
    const etfOption = await screen.findByRole("option", { name: /KODEX 200/ });
    expect(within(etfOption).getByText("ETF")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(api.posts).toHaveLength(2));
    expect(api.posts[1]).toEqual({ code: "069500", groupName: "기본", memo: null });
    const etfRow = await screen.findByRole("listitem", { name: "KODEX 200(069500)" });
    expect(within(etfRow).getByText("ETF")).toBeInTheDocument();
  });

  it("이미 담은 종목을 고르면 서버 메시지를 알린다", async () => {
    const api = mockApi([watchlistItem("005930")]);
    const { user } = renderPage();
    await screen.findByRole("listitem", { name: "삼성전자(005930)" });
    await user.type(screen.getByRole("combobox"), "005930");
    await user.click(await screen.findByRole("option", { name: /^삼성전자005930/ }));
    expect(await screen.findByText("이미 관심종목에 있습니다.")).toBeInTheDocument();
    expect(api.items).toHaveLength(1);
  });

  it("목록 행: 현재가·등락률 색·PER·PBR(null은 —)·메모·상세 링크·샘플 배지", async () => {
    mockApi([
      watchlistItem("005930", { memo: "실적 발표 확인" }),
      watchlistItem("069500", { sortOrder: 1 }),
      watchlistItem("000660", { sortOrder: 2, quote: { price: "180000", change: "0", changeRate: 0, asOf: "2026-10-16T06:30:00Z" } }),
      watchlistItem("035420", { sortOrder: 3, quote: null, metrics: null }),
    ]);
    renderPage();

    const samsung = await screen.findByRole("listitem", { name: "삼성전자(005930)" });
    expect(within(samsung).getByRole("link")).toHaveAttribute("href", "/stocks/005930");
    expect(within(samsung).getByText("102,800원")).toBeInTheDocument();
    expect(within(samsung).getByText("-1.21%").closest("[data-tone]")).toHaveAttribute("data-tone", "down");
    expect(within(samsung).getByText("PER 31.86 · PBR 0.74")).toBeInTheDocument();
    expect(within(samsung).getByText("메모: 실적 발표 확인")).toBeInTheDocument();
    expect(within(samsung).getByRole("button", { name: "삼성전자 메모·그룹 편집(메모 있음)" })).toBeInTheDocument();

    const etf = row("KODEX 200");
    expect(within(etf).getByText("PER — · PBR —")).toBeInTheDocument();
    expect(within(etf).getByText("+2.77%").closest("[data-tone]")).toHaveAttribute("data-tone", "up");
    expect(within(row("SK하이닉스")).getByText("0.00%").closest("[data-tone]")).toHaveAttribute("data-tone", "flat");

    const naver = row("NAVER");
    expect(within(naver).getAllByText("—")).toHaveLength(2);
    expect(within(naver).getByText("PER — · PBR —")).toBeInTheDocument();

    expect(screen.getByLabelText(/^샘플 데이터/)).toBeInTheDocument();
    expect(screen.getAllByRole("note").map((note) => note.getAttribute("data-variant"))).toEqual(["investment"]);
  });

  it("그룹 탭: 전체와 그룹별로 거른다", async () => {
    mockApi([
      watchlistItem("005930"),
      watchlistItem("000660", { sortOrder: 1 }),
      watchlistItem("069500", { groupName: "배당주" }),
    ]);
    const { user } = renderPage();
    await screen.findByRole("listitem", { name: "삼성전자(005930)" });

    const tabs = screen.getByRole("tablist", { name: "관심종목 그룹" });
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["전체 3", "기본 2", "배당주 1"]);
    expect(rows()).toHaveLength(3);
    expect(screen.getByRole("heading", { level: 2, name: "배당주" })).toBeInTheDocument();

    await user.click(within(tabs).getByRole("tab", { name: "배당주 1" }));
    expect(rows().map((item) => item.getAttribute("aria-label"))).toEqual(["KODEX 200(069500)"]);

    await user.click(within(tabs).getByRole("tab", { name: "기본 2" }));
    expect(rows()).toHaveLength(2);
  });

  it("고른 그룹 탭에서 검색해 담으면 그 그룹에 담는다", async () => {
    const api = mockApi([watchlistItem("069500", { groupName: "배당주" })]);
    const { user } = renderPage();
    await user.click(await screen.findByRole("tab", { name: "배당주 1" }));
    await user.type(screen.getByRole("combobox"), "NAVER");
    await user.click(await screen.findByRole("option", { name: /NAVER/ }));
    await waitFor(() => expect(api.posts).toEqual([{ code: "035420", groupName: "배당주", memo: null }]));
  });

  it("순서 이동: 위·아래 버튼이 그 그룹의 id 순서를 PUT하고, 끝에서는 막힌다", async () => {
    const [a, b, c] = [watchlistItem("005930"), watchlistItem("000660", { sortOrder: 1 }), watchlistItem("035420", { sortOrder: 2 })];
    const other = watchlistItem("069500", { groupName: "배당주" });
    const api = mockApi([a, b, c, other]);
    const { user } = renderPage();
    await screen.findByRole("listitem", { name: "삼성전자(005930)" });

    expect(screen.getByRole("button", { name: "삼성전자 위로 이동" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "NAVER 아래로 이동" })).toBeDisabled();
    // 다른 그룹 경계를 넘지 않는다.
    expect(screen.getByRole("button", { name: "KODEX 200 위로 이동" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "SK하이닉스 위로 이동" }));
    await waitFor(() => expect(api.orders).toEqual([{ groupName: "기본", ids: [b.id, a.id, c.id] }]));
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "기본 그룹" })).getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))).toEqual([
        "SK하이닉스(000660)",
        "삼성전자(005930)",
        "NAVER(035420)",
      ]),
    );

    await user.click(screen.getByRole("button", { name: "삼성전자 아래로 이동" }));
    await waitFor(() => expect(api.orders[1]).toEqual({ groupName: "기본", ids: [b.id, c.id, a.id] }));
  });

  it("삭제: 확인하면 DELETE하고 목록에서 뺀다", async () => {
    const item = watchlistItem("005930");
    const api = mockApi([item, watchlistItem("000660", { sortOrder: 1 })]);
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "삼성전자 삭제" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "빼기" }));
    await waitFor(() => expect(api.deletes).toEqual([item.id]));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "삼성전자(005930)" })).not.toBeInTheDocument());
    expect(screen.getByRole("listitem", { name: "SK하이닉스(000660)" })).toBeInTheDocument();
  });

  it("메모·그룹 편집: 바뀐 필드만 PATCH한다", async () => {
    const item = watchlistItem("005930");
    const api = mockApi([item]);
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "삼성전자 메모·그룹 편집" }));
    const dialog = await screen.findByRole("dialog", { name: "메모·그룹 편집" });
    await user.type(within(dialog).getByLabelText("메모"), "실적 발표 확인");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.patches).toEqual([{ id: item.id, body: { memo: "실적 발표 확인" } }]));
    expect(await screen.findByText("메모: 실적 발표 확인")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "삼성전자 메모·그룹 편집(메모 있음)" }));
    const second = await screen.findByRole("dialog", { name: "메모·그룹 편집" });
    const group = within(second).getByLabelText("그룹");
    await user.clear(group);
    await user.click(within(second).getByRole("button", { name: "저장" }));
    expect(await within(second).findByText("그룹 이름을 입력해 주세요.")).toBeInTheDocument();
    await user.type(group, "배당주");
    await user.click(within(second).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.patches[1]).toEqual({ id: item.id, body: { groupName: "배당주" } }));
  });

  it("그룹 관리: 이름을 바꾸면 그 그룹 항목들을 순서대로 PATCH한다", async () => {
    const [a, b] = [watchlistItem("005930"), watchlistItem("000660", { sortOrder: 1 })];
    const other = watchlistItem("069500", { groupName: "배당주" });
    const api = mockApi([a, b, other]);
    const { user } = renderPage();
    await screen.findByRole("listitem", { name: "삼성전자(005930)" });
    await user.click(screen.getByRole("button", { name: /그룹 관리/ }));
    const dialog = await screen.findByRole("dialog", { name: "그룹 관리" });
    const input = within(dialog).getByRole("textbox", { name: "기본 새 이름" });
    await user.clear(input);
    await user.type(input, "반도체");
    await user.click(within(dialog).getAllByRole("button", { name: "이름 바꾸기" })[0]);
    await waitFor(() =>
      expect(api.patches).toEqual([
        { id: a.id, body: { groupName: "반도체" } },
        { id: b.id, body: { groupName: "반도체" } },
      ]),
    );
    expect(await screen.findByText(/그룹 이름을 "반도체"/)).toBeInTheDocument();
  });

  it("화면이 보이는 동안 30초마다 다시 불러온다(탭이 숨으면 멈춤)", async () => {
    mockApi([watchlistItem("005930")]);
    const { queryClient } = renderPage();
    await screen.findByRole("listitem", { name: "삼성전자(005930)" });
    const query = queryClient.getQueryCache().find({ queryKey: watchlistKey });
    const options = query?.observers[0]?.options;
    expect(options?.refetchInterval).toBe(30_000);
    expect(options?.refetchIntervalInBackground).toBe(false);
  });
});
