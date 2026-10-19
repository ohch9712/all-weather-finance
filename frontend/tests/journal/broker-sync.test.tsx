import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncTrades } from "@/features/journal/api";
import { JournalPage } from "@/features/journal/components/JournalPage";
import type { BrokerConnection, SyncInput, SyncResult } from "@/features/journal/types";
import { TIMEOUT_ERROR_MESSAGE } from "@/lib/api-client";
import { apiUrl, errorResponse, renderWithProviders, server } from "../utils";

const kiwoom: BrokerConnection = { id: "kiwoom-1", label: "키움 계좌", provider: "kiwoom", status: "active" };
const pendingToss: BrokerConnection = { id: "toss-1", label: "확인 전 토스", provider: "toss", status: "pending" };
const sample: BrokerConnection = { id: "mock-1", label: "샘플 연결", provider: "mock", status: "active" };
const result = (overrides: Partial<SyncResult> = {}): SyncResult => ({ inserted: 3, updated: 1, unchanged: 5, skippedDuplicates: 0, costEstimated: 0, from: "2026-10-13", to: "2026-10-19", syncedAt: "2026-10-18T16:30:00Z", ...overrides });
const sampleLine = "샘플 연결: 추가 3건 · 갱신 1건 · 변화 없음 5건 · 건너뜀 0건";
const costNotice = /증권사가 수수료·세금을 주지 않아 기본 요율로 추정했어요/;

let tradeRequests = 0;
function mockJournal(connections: BrokerConnection[]) {
  tradeRequests = 0;
  server.use(
    http.get(apiUrl("/api/market/connections"), () => HttpResponse.json({ items: connections })),
    http.get(apiUrl("/api/journal/trades"), () => { tradeRequests += 1; return HttpResponse.json({ items: [], page: 1, pageSize: 20, total: 0 }); }),
  );
}
const resultArea = () => screen.getByRole("status", { name: "증권사 동기화 결과" });
async function clickSync(user: ReturnType<typeof renderWithProviders>["user"]) {
  const button = screen.getByRole("button", { name: "증권사 동기화" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe("매매일지 증권사 동기화 버튼", () => {
  // KST로는 10월 19일 01:30이다(UTC로는 아직 10월 18일).
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-18T16:30:00Z") }); });
  afterEach(() => { vi.useRealTimers(); });

  it("활성 연결만 목록 순서대로 최근 7일을 요청하고, 실패한 연결 뒤에도 계속하며 성공하면 목록을 다시 불러온다", async () => {
    mockJournal([kiwoom, pendingToss, sample]);
    const bodies: SyncInput[] = [];
    server.use(http.post(apiUrl("/api/journal/sync"), async ({ request }) => {
      const body = await request.json() as SyncInput; bodies.push(body);
      return body.connectionId === kiwoom.id ? errorResponse(502, "BROKER_UNAVAILABLE", "증권사 응답을 받지 못했습니다.") : HttpResponse.json(result());
    }));
    const { user } = renderWithProviders(<JournalPage />, { route: "/journal" });
    await waitFor(() => expect(tradeRequests).toBe(1));
    await clickSync(user);
    const area = resultArea();
    expect(await within(area).findByText(sampleLine)).toBeInTheDocument();
    expect(bodies).toEqual([{ connectionId: "kiwoom-1", from: "2026-10-13", to: "2026-10-19" }, { connectionId: "mock-1", from: "2026-10-13", to: "2026-10-19" }]);
    const failed = within(area).getByText("키움 계좌: 증권사 응답을 받지 못했습니다.");
    expect(within(failed.closest("li")!).queryByLabelText(/샘플 데이터:/)).not.toBeInTheDocument();
    expect(within(within(area).getByText(sampleLine).closest("li")!).getByLabelText(/샘플 데이터:/)).toBeInTheDocument();
    expect(within(area).queryByText(/확인 전 토스/)).not.toBeInTheDocument();
    expect(area).toHaveTextContent("최근 7일(10월 13일~10월 19일)을 불러왔습니다. 더 긴 기간은 가져오기에서 고를 수 있습니다.");
    expect(within(area).getByRole("link", { name: "가져오기" })).toHaveAttribute("href", "/journal/import");
    expect(within(area).queryByText(costNotice)).not.toBeInTheDocument();
    await waitFor(() => expect(tradeRequests).toBe(2));
  });

  it("진행 중에는 버튼을 끄고, 비용을 추정한 연결이 있으면 비용 설정 안내를 보여 준다", async () => {
    mockJournal([kiwoom]);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    server.use(http.post(apiUrl("/api/journal/sync"), async () => { await gate; return HttpResponse.json(result({ costEstimated: 2 })); }));
    const { user } = renderWithProviders(<JournalPage />, { route: "/journal" });
    await clickSync(user);
    expect(screen.getByRole("button", { name: "동기화 중…" })).toBeDisabled();
    release();
    const area = resultArea();
    expect(await within(area).findByText("키움 계좌: 추가 3건 · 갱신 1건 · 변화 없음 5건 · 건너뜀 0건")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "증권사 동기화" })).toBeEnabled();
    expect(within(area).getByText(costNotice)).toBeInTheDocument();
    expect(within(area).getByRole("link", { name: "수수료·세금 설정" })).toHaveAttribute("href", "/settings/trading-costs");
    expect(within(area).queryByLabelText(/샘플 데이터:/)).not.toBeInTheDocument();
  });

  it("모든 연결이 실패하면 매매일지 목록을 다시 불러오지 않는다", async () => {
    mockJournal([kiwoom]);
    server.use(http.post(apiUrl("/api/journal/sync"), () => errorResponse(409, "BROKER_NOT_CONNECTED", "증권사 연결을 먼저 확인해 주세요.")));
    const { user } = renderWithProviders(<JournalPage />, { route: "/journal" });
    await waitFor(() => expect(tradeRequests).toBe(1));
    await clickSync(user);
    expect(await within(resultArea()).findByText("키움 계좌: 증권사 연결을 먼저 확인해 주세요.")).toBeInTheDocument();
    expect(tradeRequests).toBe(1);
  });

  it("활성 연결이 없으면 동기화하지 않고 연결 설정 안내와 링크를 보여 준다", async () => {
    mockJournal([pendingToss]);
    let requested = false;
    server.use(http.post(apiUrl("/api/journal/sync"), () => { requested = true; return HttpResponse.json(result()); }));
    const { user } = renderWithProviders(<JournalPage />, { route: "/journal" });
    await clickSync(user);
    const area = resultArea();
    expect(await within(area).findByText(/동기화할 증권사 연결이 없습니다\./)).toBeInTheDocument();
    expect(within(area).getByRole("link", { name: "증권사 연결 설정" })).toHaveAttribute("href", "/settings/connections");
    expect(requested).toBe(false);
  });

  it("연결 목록을 불러오는 중에는 버튼을 끈다", async () => {
    mockJournal([]);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    server.use(http.get(apiUrl("/api/market/connections"), async () => { await gate; return HttpResponse.json({ items: [sample] }); }));
    renderWithProviders(<JournalPage />, { route: "/journal" });
    const button = screen.getByRole("button", { name: "증권사 동기화" });
    expect(button).toBeDisabled();
    release();
    await waitFor(() => expect(button).toBeEnabled());
  });
});

describe("체결 동기화 요청 제한 시간", () => {
  afterEach(() => { vi.useRealTimers(); });
  const input: SyncInput = { connectionId: "kiwoom-1", from: "2026-09-20", to: "2026-10-19" };

  it("기본 10초를 넘겨 15초 걸리는 키움 30일 동기화도 결과를 받는다", async () => {
    vi.useFakeTimers();
    server.use(http.post(apiUrl("/api/journal/sync"), async () => { await delay(15_000); return HttpResponse.json(result()); }));
    const request = syncTrades(input);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(request).resolves.toMatchObject({ inserted: 3 });
  });

  it("120초가 지나면 시간 초과로 끊는다", async () => {
    vi.useFakeTimers();
    server.use(http.post(apiUrl("/api/journal/sync"), async () => { await delay(121_000); return HttpResponse.json(result()); }));
    const request = syncTrades(input);
    const settled = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(119_999);
    let done = false; void settled.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toMatchObject({ code: "TIMEOUT", message: TIMEOUT_ERROR_MESSAGE });
  });
});
