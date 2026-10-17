import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, it, vi } from "vitest";
import { JournalImportPage } from "@/features/journal/components/JournalImportPage";
import { JournalPage } from "@/features/journal/components/JournalPage";
import type { ImportJob } from "@/features/imports";
import { apiUrl, createTestQueryClient, errorResponse, renderWithProviders, server } from "../utils";

function setup(provider = "mock") {
  server.use(
    http.get(apiUrl("/api/ai/status"), () => HttpResponse.json({ personal: { enabled: false, provider: null, location: null, model: null, reason: "not_configured" } })),
    http.get(apiUrl("/api/market/connections"), () => HttpResponse.json({ items: [{ id: "conn-1", label: "내 연결", provider, status: "active" }, { id: "inactive", label: "비활성 연결", provider, status: "pending" }] })),
    http.get(apiUrl("/api/journal/sync/status"), () => HttpResponse.json({ items: [{ connectionId: "conn-1", label: "내 연결", provider, lastSyncedAt: null, tradeCount: 0 }] })),
  );
}

it("증권사 불러오기 결과와 샘플 고지를 보여 주고 모든 매매일지 캐시를 갱신한다", async () => {
  setup(); let payload: unknown;
  server.use(http.post(apiUrl("/api/journal/sync"), async ({ request }) => { payload = await request.json(); return HttpResponse.json({ inserted: 20, updated: 0, unchanged: 0, skippedDuplicates: 1, from: "2026-09-01", to: "2026-10-16", syncedAt: "2026-10-16T00:00:00Z" }); }));
  const client = createTestQueryClient(); const invalidate = vi.spyOn(client, "invalidateQueries");
  const { user } = renderWithProviders(<JournalImportPage />, { queryClient: client });
  await screen.findByRole("option", { name: "내 연결 (샘플)" });
  expect(screen.queryByRole("option", { name: /비활성/ })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("증권사 연결"), "conn-1");
  expect(screen.getByText("샘플 데이터입니다. 실제 시세가 아닙니다.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "불러오기" }));
  expect(await screen.findByText("삽입 20건 · 갱신 0건 · 변화 없음 0건 · 건너뜀 1건")).toBeInTheDocument();
  expect(payload).toMatchObject({ connectionId: "conn-1" });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["journal"] });
  expect(screen.getByRole("link", { name: "수수료·세금 설정" })).toHaveAttribute("href", "/settings/trading-costs");
});

it("토스 미지원 오류를 안내한다", async () => {
  setup("toss"); server.use(http.post(apiUrl("/api/journal/sync"), () => errorResponse(501, "BROKER_NOT_SUPPORTED", "미지원")));
  const { user } = renderWithProviders(<JournalImportPage />);
  await user.selectOptions(await screen.findByLabelText("증권사 연결"), "conn-1");
  await user.click(screen.getByRole("button", { name: "불러오기" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("토스증권은 개별 체결 조회를 지원하지 않아요");
});

it("파일 위저드 저장 후에도 매매일지 캐시를 갱신한다", async () => {
  setup();
  const job: ImportJob = { id: "job-1", kind: "journal_trades", status: "parsed", fileName: "generic.csv", fileType: "csv", sheetNames: ["Sheet1"], sheetName: "Sheet1", headerRow: 1,
    fields: [{ key: "symbolName", label: "종목명", type: "text", required: true }], columns: [{ index: 0, header: "종목명", samples: ["삼성전자"] }], mapping: { symbolName: 0 }, mappingSource: "synonym", presetKey: null, rowCount: 1, skippedRowCount: 0, warnings: [], expiresAt: "2026-10-18T00:00:00Z", preview: null, result: null };
  const preview = { validCount: 1, invalidCount: 0, page: 1, pageSize: 50, total: 1, rows: [{ rowNumber: 2, values: { symbolName: "삼성전자" }, errors: [] }] };
  server.use(
    http.post(apiUrl("/api/imports/jobs"), async ({ request }) => { expect(await request.text()).toContain("journal_trades"); return HttpResponse.json(job, { status: 201 }); }),
    http.put(apiUrl("/api/imports/jobs/job-1/mapping"), () => HttpResponse.json({ ...job, status: "mapped", preview })),
    http.get(apiUrl("/api/imports/jobs/job-1/preview"), () => HttpResponse.json(preview)),
    http.post(apiUrl("/api/imports/jobs/job-1/commit"), () => HttpResponse.json({ ...job, status: "committed", result: { inserted: 1, skippedDuplicates: 0, failed: 0, errors: [] } })),
  );
  const client = createTestQueryClient(); const invalidate = vi.spyOn(client, "invalidateQueries");
  const { user } = renderWithProviders(<JournalImportPage />, { queryClient: client });
  await user.upload(screen.getByLabelText("가져올 파일"), new File(["종목명\n삼성전자"], "generic.csv", { type: "text/csv" }));
  await user.click(await screen.findByRole("button", { name: "매핑 확정" }));
  await user.click(await screen.findByRole("button", { name: "저장하기" }));
  await screen.findByText("저장 1건 · 중복 0건 · 실패 0건");
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["journal"] }));
});

it("보유 평가손익과 시세 없는 값, 샘플 배지를 보여 준다", async () => {
  const base = { market: "KRX", symbolCode: "005930", symbolName: "삼성전자", currency: "KRW", quantity: "2", avgCost: "10050", costBasis: "20100", realizedPnl: "0", firstTradedOn: "2026-10-01", lastTradedOn: "2026-10-01", tradeCount: 1, hasOversold: false };
  server.use(http.get(apiUrl("/api/journal/positions"), () => HttpResponse.json({ items: [{ ...base, currentPrice: "12000", evalAmount: "24000", unrealizedPnl: "3900", unrealizedPnlRate: 19.4, quoteSource: "mock" }, { ...base, market: "US", symbolCode: "AAPL", symbolName: "애플", currency: "USD", currentPrice: null, evalAmount: null, unrealizedPnl: null, unrealizedPnlRate: null, quoteSource: null }] })));
  renderWithProviders(<JournalPage />, { route: "/journal?tab=positions" });
  expect(await screen.findByText("24,000원")).toBeInTheDocument();
  expect(screen.getByText("+3,900원")).toHaveClass("text-money-up");
  expect(screen.getByText("+19.40%")).toHaveClass("text-money-up");
  expect(screen.getByLabelText(/샘플 데이터:/)).toBeInTheDocument();
  expect(screen.getAllByText("현재가")).toHaveLength(2);
});
