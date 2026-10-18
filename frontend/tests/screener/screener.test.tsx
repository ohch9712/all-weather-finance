import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenerPage } from "@/features/screener/components/ScreenerPage";
import {
  decodeFilter,
  emptyFilter,
  encodeFilter,
} from "@/features/screener/utils";
import type { ScreenFilter, ScreenResult } from "@/features/screener/types";
import { apiUrl, errorResponse, renderWithProviders, server } from "../utils";
import golden from "./encoding.json";

const scope = {
  enabled: true,
  provider: "gemini",
  location: "cloud",
  model: "test",
  reason: null,
};
const item = {
  code: "005930",
  name: "삼성전자",
  market: "KOSPI",
  sector: "반도체",
  kind: "stock" as const,
  price: "71200",
  changeRate: -1.11,
  marketCap: 425000000000000,
  per: "12.40",
  pbr: "1.30",
  roe: "10.50",
  tradingValue: 879000000000,
};
const results: ScreenResult = {
  asOf: "2026-10-16",
  source: "mock",
  total: 2,
  excludedForMissingData: 3,
  items: [
    item,
    {
      ...item,
      code: "069500",
      name: "KODEX 200",
      kind: "etf",
      per: null,
      pbr: null,
      roe: null,
    },
  ],
};
const parsedFilter: ScreenFilter = {
  ...emptyFilter(),
  markets: ["KOSPI"],
  conditions: [{ field: "per", op: "lte", value: "10", valueTo: null }],
};

beforeEach(() => {
  server.use(
    http.get(apiUrl("/api/ai/status"), () =>
      HttpResponse.json({ general: scope, personal: scope }),
    ),
    http.get(apiUrl("/api/screener/saved"), () =>
      HttpResponse.json({ items: [] }),
    ),
    http.get(apiUrl("/api/market/connections"), () =>
      HttpResponse.json({
        items: [
          {
            id: "conn",
            provider: "kiwoom",
            label: "내 키움",
            status: "active",
          },
        ],
      }),
    ),
    http.get(apiUrl("/api/screener/broker-conditions"), () =>
      HttpResponse.json({
        items: [
          { seq: "0", name: "샘플 저PER" },
          { seq: "1", name: "샘플 대형주" },
        ],
        source: "mock",
      }),
    ),
    http.post(apiUrl("/api/screener/run"), () => HttpResponse.json(results)),
    http.post(apiUrl("/api/screener/parse"), () =>
      HttpResponse.json({
        filter: parsedFilter,
        explanation: "코스피에서 PER 10 이하인 종목을 찾아요.",
        unsupported: [{ text: "배당", reason: "지원하지 않는 지표예요." }],
        chips: [{ label: "코스피" }, { label: "PER ≤ 10배" }],
      }),
    ),
  );
});

describe("조건검색 화면", () => {
  it("자연어를 칩으로 바꾸고 수정 후 실행하며 409를 안내한다", async () => {
    let requested: ScreenFilter | undefined;
    server.use(
      http.post(apiUrl("/api/screener/run"), async ({ request }) => {
        requested = ((await request.json()) as { filter: ScreenFilter }).filter;
        return HttpResponse.json(results);
      }),
      http.post(apiUrl("/api/watchlist"), async ({ request }) => {
        expect(await request.json()).toMatchObject({
          code: "005930",
          groupName: "기본",
        });
        return errorResponse(409, "CONFLICT", "이미 관심종목에 있습니다.");
      }),
    );
    const { user } = renderWithProviders(<ScreenerPage />);
    await user.type(
      await screen.findByLabelText("원하는 조건"),
      "코스피 PER 10 이하 배당",
    );
    await user.click(screen.getByRole("button", { name: "조건 해석" }));
    expect(
      await screen.findByText("코스피에서 PER 10 이하인 종목을 찾아요."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("배당: 지원하지 않는 지표예요."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "PER ≤ 10 수정" }));
    await user.clear(screen.getByLabelText("값"));
    await user.type(screen.getByLabelText("값"), "15");
    await user.click(screen.getByRole("button", { name: "조건 적용" }));
    expect(
      screen.getByText("배당: 지원하지 않는 지표예요."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(requested?.conditions[0].value).toBe("15");
    const table = within(screen.getByRole("table"));
    expect(table.getByText("ETF")).toBeInTheDocument();
    expect(table.getAllByText("—")).toHaveLength(3);
    expect(
      screen.getByText(/지표 누락으로 제외된 종목 3개/),
    ).toBeInTheDocument();
    expect(table.getByRole("link", { name: "삼성전자" })).toHaveAttribute(
      "href",
      "/stocks/005930",
    );
    await user.click(
      table.getAllByRole("button", { name: "관심종목 담기" })[0],
    );
    expect((await screen.findAllByText("이미 있어요")).length).toBeGreaterThan(
      0,
    );
    await user.click(table.getByRole("button", { name: /PER/ }));
    await waitFor(() =>
      expect(requested?.sort).toEqual({ field: "per", direction: "asc" }),
    );
  });
  it("숫자 열의 정렬을 asc에서 desc로 전환하고 재조회 중 표를 유지한다", async () => {
    const requested: ScreenFilter["sort"][] = [];
    let release: (() => void) | undefined;
    server.use(
      http.post(apiUrl("/api/screener/run"), async ({ request }) => {
        const { filter } = (await request.json()) as { filter: ScreenFilter };
        requested.push(filter.sort);
        if (requested.length > 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return HttpResponse.json(results);
      }),
    );
    const { user } = renderWithProviders(<ScreenerPage />);
    await user.click(screen.getByRole("button", { name: "검색" }));
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: /PER/ }));
    await waitFor(() =>
      expect(requested.at(-1)).toEqual({ field: "per", direction: "asc" }),
    );
    expect(screen.getByRole("table")).toBe(table);
    expect(screen.getByText("종목을 검색하고 있어요.")).toBeInTheDocument();
    release?.();
    await waitFor(() =>
      expect(
        screen.queryByText("종목을 검색하고 있어요."),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(table).getByRole("columnheader", { name: "PER ↑" }),
    ).toHaveAttribute("aria-sort", "ascending");
    await user.click(within(table).getByRole("button", { name: "PER ↑" }));
    await waitFor(() =>
      expect(requested.slice(1)).toEqual([
        { field: "per", direction: "asc" },
        { field: "per", direction: "desc" },
      ]),
    );
    expect(screen.getByRole("table")).toBe(table);
    release?.();
    await waitFor(() =>
      expect(
        screen.queryByText("종목을 검색하고 있어요."),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(table).getByRole("columnheader", { name: "PER ↓" }),
    ).toHaveAttribute("aria-sort", "descending");
  });
  it("모바일 정렬 필드를 응답 후 유지하고 해당 필드의 방향을 바꾼다", async () => {
    const requested: ScreenFilter["sort"][] = [];
    server.use(
      http.post(apiUrl("/api/screener/run"), async ({ request }) => {
        requested.push(
          ((await request.json()) as { filter: ScreenFilter }).filter.sort,
        );
        return HttpResponse.json(results);
      }),
    );
    const { user } = renderWithProviders(<ScreenerPage />);
    await user.click(screen.getByRole("button", { name: "검색" }));
    await user.selectOptions(await screen.findByLabelText("결과 정렬"), "per");
    await waitFor(() =>
      expect(requested.at(-1)).toEqual({ field: "per", direction: "asc" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("종목을 검색하고 있어요."),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("결과 정렬")).toHaveValue("per");
    await user.click(screen.getByRole("button", { name: "정렬 방향 바꾸기" }));
    await waitFor(() =>
      expect(requested.at(-1)).toEqual({ field: "per", direction: "desc" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("종목을 검색하고 있어요."),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("결과 정렬")).toHaveValue("per");
  });
  it("URL과 저장한 검색의 sort를 헤더와 다음 정렬 요청에 적용한다", async () => {
    const requested: ScreenFilter["sort"][] = [];
    const urlFilter: ScreenFilter = {
      ...emptyFilter(),
      sort: { field: "per", direction: "desc" },
    };
    const savedFilter: ScreenFilter = {
      ...emptyFilter(),
      sort: { field: "pbr", direction: "desc" },
    };
    server.use(
      http.post(apiUrl("/api/screener/run"), async ({ request }) => {
        requested.push(
          ((await request.json()) as { filter: ScreenFilter }).filter.sort,
        );
        return HttpResponse.json(results);
      }),
      http.get(apiUrl("/api/screener/saved"), () =>
        HttpResponse.json({
          items: [
            {
              id: "sorted",
              name: "정렬한 검색",
              queryText: null,
              filter: savedFilter,
              createdAt: "2026-10-16T00:00:00Z",
            },
          ],
        }),
      ),
    );
    const { user } = renderWithProviders(<ScreenerPage />, {
      route: `/stocks/screener?f=${encodeFilter(urlFilter)}`,
    });
    await screen.findByRole("table");
    expect(screen.getByRole("columnheader", { name: "PER ↓" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getByLabelText("결과 정렬")).toHaveValue("per");
    await user.click(screen.getByRole("button", { name: "PER ↓" }));
    await waitFor(() =>
      expect(requested.at(-1)).toEqual({ field: "per", direction: "asc" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("종목을 검색하고 있어요."),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "불러오기" }));
    await user.click(screen.getByRole("button", { name: "검색" }));
    await screen.findByRole("table");
    expect(requested.at(-1)).toEqual(savedFilter.sort);
    expect(screen.getByLabelText("결과 정렬")).toHaveValue("pbr");
    expect(screen.getByRole("columnheader", { name: "PBR ↓" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await user.click(screen.getByRole("button", { name: "정렬 방향 바꾸기" }));
    await waitFor(() =>
      expect(requested.at(-1)).toEqual({ field: "pbr", direction: "asc" }),
    );
  });
  it("URL 필터로 바로 실행하고 ETF 종류를 표시한다", async () => {
    const filter = { ...emptyFilter(), kinds: ["etf"] as ["etf"] };
    const handler = vi.fn(() => HttpResponse.json(results));
    server.use(http.post(apiUrl("/api/screener/run"), handler));
    renderWithProviders(<ScreenerPage />, {
      route: `/stocks/screener?f=${encodeFilter(filter)}`,
    });
    await screen.findByRole("table");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("종류")).toHaveValue("etf");
    expect(screen.getAllByLabelText(/샘플 데이터/).length).toBeGreaterThan(0);
  });
  it("잘못된 URL은 실행하지 않고 직접 조건을 허용한다", async () => {
    const handler = vi.fn(() => HttpResponse.json(results));
    server.use(http.post(apiUrl("/api/screener/run"), handler));
    renderWithProviders(<ScreenerPage />, {
      route: "/stocks/screener?f=invalid",
    });
    expect(
      await screen.findByText(/검색 링크가 올바르지 않습니다/),
    ).toBeInTheDocument();
    expect(handler).not.toHaveBeenCalled();
  });
  it("AI 꺼짐에서 직접 between 조건을 검증하고 추가·삭제한다", async () => {
    server.use(
      http.get(apiUrl("/api/ai/status"), () =>
        HttpResponse.json({
          general: { ...scope, enabled: false },
          personal: scope,
        }),
      ),
    );
    const { user } = renderWithProviders(<ScreenerPage />);
    await screen.findByText(/AI가 꺼져 있어요/);
    expect(screen.queryByLabelText("원하는 조건")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "직접 조건 추가" }));
    await user.selectOptions(screen.getByLabelText("연산자"), "between");
    await user.type(screen.getByLabelText("끝값"), "5");
    await user.click(screen.getByRole("button", { name: "조건 적용" }));
    expect(await screen.findByText(/범위의 끝값을 확인/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("끝값"));
    await user.type(screen.getByLabelText("끝값"), "20");
    await user.click(screen.getByRole("button", { name: "조건 적용" }));
    expect(
      screen.getByRole("button", { name: "PER 범위 10 ~ 20 수정" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "조건 1 삭제" }));
    expect(
      screen.queryByRole("button", { name: /PER 범위/ }),
    ).not.toBeInTheDocument();
  });
  it("검색 저장·불러오기·삭제를 연결한다", async () => {
    const saved = {
      id: "saved",
      name: "내 검색",
      queryText: "저PER",
      filter: parsedFilter,
      createdAt: "2026-10-16T00:00:00Z",
    };
    let items = [saved];
    server.use(
      http.get(apiUrl("/api/screener/saved"), () =>
        HttpResponse.json({ items }),
      ),
      http.post(apiUrl("/api/screener/saved"), async ({ request }) => {
        expect(await request.json()).toMatchObject({
          name: "새 검색",
          filter: parsedFilter,
        });
        return HttpResponse.json(saved, { status: 201 });
      }),
      http.delete(apiUrl("/api/screener/saved/saved"), () => {
        items = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderWithProviders(<ScreenerPage />);
    await user.click(await screen.findByRole("button", { name: "불러오기" }));
    expect(
      screen.getByRole("button", { name: "PER ≤ 10 수정" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("검색 이름"), "새 검색");
    await user.click(screen.getByRole("button", { name: "이 조건 저장" }));
    expect(await screen.findByText("검색을 저장했어요.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "내 검색 삭제" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "불러오기" }),
      ).not.toBeInTheDocument(),
    );
  });
  it("active 키움 연결만 보여 주고 첫 연결로 조회·실행한 뒤 변경 오류를 안내한다", async () => {
    let selection: unknown;
    const requests: (string | null)[] = [];
    let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(apiUrl("/api/market/connections"), async () => {
        await ready;
        return HttpResponse.json({
          items: [
            {
              id: "inactive",
              provider: "kiwoom",
              status: "error",
              label: "만료 키움",
            },
            {
              id: "mock",
              provider: "mock",
              status: "active",
              label: "샘플 연결",
            },
            {
              id: "toss",
              provider: "toss",
              status: "active",
              label: "내 토스",
            },
            {
              id: "conn",
              provider: "kiwoom",
              status: "active",
              label: "첫 키움",
            },
            {
              id: "second",
              provider: "kiwoom",
              status: "active",
              label: "둘째 키움",
            },
          ],
        });
      }),
      http.post(
        apiUrl("/api/screener/broker-conditions/run"),
        async ({ request }) => {
          selection = await request.json();
          return HttpResponse.json({ ...results, source: "kiwoom_condition" });
        },
      ),
      http.get(apiUrl("/api/screener/broker-conditions"), ({ request }) => {
        const id = new URL(request.url).searchParams.get("connectionId");
        requests.push(id);
        return id === "second"
          ? errorResponse(
              501,
              "BROKER_NOT_SUPPORTED",
              "지원하지 않는 기능입니다.",
            )
          : HttpResponse.json({
              items: [{ seq: "0", name: "내 저PER" }],
              source: "kiwoom",
            });
      }),
    );
    const { user } = renderWithProviders(<ScreenerPage />);
    await user.click(screen.getByRole("tab", { name: "내 키움 조건식" }));
    expect(
      screen.getByText("증권사 연결을 확인하고 있어요."),
    ).toBeInTheDocument();
    expect(requests).toEqual([]);
    release?.();
    await user.click(
      await screen.findByRole("button", { name: "내 저PER 실행" }),
    );
    await screen.findByRole("table");
    expect(selection).toEqual({ seq: "0", connectionId: "conn" });
    expect(requests).toEqual(["conn"]);
    expect(screen.getByLabelText("연결 선택")).toHaveValue("conn");
    expect(
      within(screen.getByLabelText("연결 선택"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["첫 키움 (연결됨)", "둘째 키움 (연결됨)"]);
    expect(screen.queryByText("운영자 데이터")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("연결 선택"), "second");
    expect(
      await screen.findByText("지원하지 않는 기능입니다."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("연결이 없고 목록이 422이면 내 키움 연결 안내와 설정 링크를 보여 준다", async () => {
    const requests: (string | null)[] = [];
    server.use(
      http.get(apiUrl("/api/market/connections"), () =>
        HttpResponse.json({ items: [] }),
      ),
      http.get(apiUrl("/api/screener/broker-conditions"), ({ request }) => {
        requests.push(new URL(request.url).searchParams.get("connectionId"));
        return errorResponse(
          422,
          "VALIDATION_ERROR",
          "입력값을 확인해 주세요.",
          [
            {
              field: "connectionId",
              message: "내 키움 증권사 연결을 선택해 주세요.",
            },
          ],
        );
      }),
    );
    const { user } = renderWithProviders(<ScreenerPage />);
    await user.click(screen.getByRole("tab", { name: "내 키움 조건식" }));
    expect(
      await screen.findByText(
        "내 키움 증권사 연결이 필요합니다. 키움 HTS에서 만든 내 조건식만 실행할 수 있습니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "증권사 연결 설정" }),
    ).toHaveAttribute("href", "/settings/connections");
    expect(requests).toEqual([null]);
    expect(screen.queryByLabelText("연결 선택")).not.toBeInTheDocument();
    expect(screen.queryByText("운영자 데이터")).not.toBeInTheDocument();
    expect(screen.queryByText("샘플 조건식")).not.toBeInTheDocument();
  });
  it("연결이 없고 Mock 목록이 200이면 샘플 조건식 2개를 표시하고 실행한다", async () => {
    const requests: (string | null)[] = [];
    let selection: unknown;
    server.use(
      http.get(apiUrl("/api/market/connections"), () =>
        HttpResponse.json({ items: [] }),
      ),
      http.get(apiUrl("/api/screener/broker-conditions"), ({ request }) => {
        requests.push(new URL(request.url).searchParams.get("connectionId"));
        return HttpResponse.json({
          items: [
            { seq: "0", name: "샘플 저PER" },
            { seq: "1", name: "샘플 대형주" },
          ],
          source: "mock",
        });
      }),
      http.post(
        apiUrl("/api/screener/broker-conditions/run"),
        async ({ request }) => {
          selection = await request.json();
          return HttpResponse.json(results);
        },
      ),
    );
    const { user } = renderWithProviders(<ScreenerPage />);
    await user.click(screen.getByRole("tab", { name: "내 키움 조건식" }));
    expect(await screen.findByText("샘플 조건식")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "샘플 대형주 실행" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "샘플 저PER 실행" }));
    await screen.findByRole("table");
    expect(selection).toEqual({ seq: "0", connectionId: null });
    expect(requests).toEqual([null]);
    expect(screen.queryByText("운영자 데이터")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("연결 선택")).not.toBeInTheDocument();
  });
  it("미수집 데이터와 LLM 오류를 안내한다", async () => {
    server.use(
      http.post(apiUrl("/api/screener/run"), () =>
        HttpResponse.json({ ...results, asOf: null, total: 0, items: [] }),
      ),
      http.post(apiUrl("/api/screener/parse"), () =>
        errorResponse(503, "LLM_UNAVAILABLE", "조건을 이해하지 못했어요."),
      ),
    );
    const { user } = renderWithProviders(<ScreenerPage />);
    await user.click(screen.getByRole("button", { name: "검색" }));
    expect(
      await screen.findByText("종목 데이터가 아직 없습니다"),
    ).toBeInTheDocument();
    await user.type(
      await screen.findByLabelText("원하는 조건"),
      "알 수 없는 조건",
    );
    await user.click(screen.getByRole("button", { name: "조건 해석" }));
    expect(
      await screen.findByText("조건을 이해하지 못했어요."),
    ).toBeInTheDocument();
  });
});

it("백엔드와 같은 UTF-8·소수·키 정렬 인코딩을 쓴다", () => {
  const filter = golden.filter as ScreenFilter;
  expect(encodeFilter(filter)).toBe(golden.encoded);
  expect(decodeFilter(golden.encoded)).toEqual(golden.canonical);
  for (const [value, expected] of [
    ["1e2", "1E+2"],
    ["001.2300", "1.2300"],
    ["1e-7", "1E-7"],
    ["-0.00", "-0.00"],
    ["1e-6", "0.000001"],
  ]) {
    const encoded = encodeFilter({
      ...emptyFilter(),
      conditions: [{ field: "per", op: "lte", value, valueTo: null }],
    });
    expect(decodeFilter(encoded).conditions[0].value).toBe(expected);
  }
  expect(() =>
    decodeFilter(
      btoa('{"conditions":[{"field":"sql","op":"gt","value":"1"}]}'),
    ),
  ).toThrow();
});
