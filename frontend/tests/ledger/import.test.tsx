import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import type { ImportJob } from "@/features/imports";
import { LedgerImportPage } from "@/features/ledger/components/LedgerImportPage";
import { LedgerImportReview } from "@/features/ledger/components/LedgerImportReview";
import { ExtractedStatementWizard } from "@/features/ledger/components/ExtractedStatementWizard";
import { getCategories, getEntries, getSummary, getTrend } from "@/features/ledger/api";
import { ledgerKeys } from "@/features/ledger/hooks";
import { apiUrl, createTestQueryClient, errorResponse, memoryRouter, renderWithProviders, server } from "../utils";
import { mockLedger } from "./mock-ledger";

const job: ImportJob = {
  id: "batch-1", kind: "ledger_card", status: "parsed", fileName: "generic.pdf", fileType: "csv",
  sheetNames: [], sheetName: null, headerRow: 1,
  columns: [{ index: 0, header: "이용일", samples: ["2026-10-01"] }, { index: 1, header: "가맹점", samples: ["상점"] }, { index: 2, header: "금액", samples: ["5000"] }],
  fields: [{ key: "occurredOn", label: "이용일", type: "date", required: true }, { key: "merchant", label: "가맹점", type: "text", required: true }, { key: "amount", label: "금액", type: "amount", required: true }],
  mapping: { occurredOn: 0, merchant: 1, amount: 2 }, mappingSource: "synonym", presetKey: null,
  rowCount: 1, skippedRowCount: 0, warnings: ["원문을 확인하세요."], expiresAt: "2026-10-18T00:00:00Z",
  preview: { validCount: 1, invalidCount: 0, page: 1, pageSize: 50, total: 1, rows: [{ rowNumber: 2, values: { occurredOn: "2026-10-01", merchant: "상점", amount: 5000 }, errors: [] }] }, result: null,
};

function mockImports(provider: "ollama" | "gemini" | null = "ollama") {
  const requests: { path: string; body: unknown }[] = [];
  server.use(
    http.get(apiUrl("/api/ai/status"), () => HttpResponse.json({ general: { enabled: false, provider: null, location: null, model: null, reason: "not_configured" }, personal: { enabled: provider !== null, provider, location: provider === "ollama" ? "local" : provider === "gemini" ? "cloud" : null, model: provider ? "가짜 모델" : null, reason: provider ? null : "not_configured" } })),
    http.post(apiUrl("/api/imports/jobs"), async ({ request }) => { const body = await request.text(); requests.push({ path: "upload", body }); return HttpResponse.json(job, { status: 201 }); }),
    http.post(apiUrl("/api/ledger/import/extract"), async ({ request }) => { const body = await request.text(); requests.push({ path: "extract", body }); return HttpResponse.json(job); }),
    http.put(apiUrl("/api/imports/jobs/:id/mapping"), async ({ request }) => { requests.push({ path: "mapping", body: await request.json() }); return HttpResponse.json({ ...job, status: "mapped" }); }),
    http.get(apiUrl("/api/imports/jobs/:id/preview"), () => HttpResponse.json(job.preview)),
    http.post(apiUrl("/api/imports/jobs/:id/commit"), async ({ request }) => { requests.push({ path: "commit", body: await request.json() }); return HttpResponse.json({ ...job, status: "committed", result: { inserted: 1, skippedDuplicates: 0, failed: 0, errors: [] } }); }),
  );
  return requests;
}

describe("카드 명세서 가져오기", () => {
  it.each(["table", "ai"])("%s 저장 후 30초 이내의 기존 가계부 캐시도 새로 읽는다", async (tab) => {
    mockImports();
    const state = mockLedger([{ occurredOn: "2026-10-01", amount: 5000, category: "식비", merchant: "기존 상점" }]);
    const client = createTestQueryClient();
    client.setDefaultOptions({ queries: { staleTime: 30_000, retry: false } });
    const params = { month: "2026-10", kind: null, categoryId: null, q: "", page: 1, pageSize: 20 };
    const queries = {
      summary: { queryKey: ledgerKeys.summary("2026-10"), queryFn: () => getSummary("2026-10") },
      entries: { queryKey: ledgerKeys.entryList(params), queryFn: () => getEntries(params) },
      trend: { queryKey: ledgerKeys.trend(6), queryFn: () => getTrend(6) },
      categories: { queryKey: ledgerKeys.categories(), queryFn: getCategories },
    };
    expect((await client.fetchQuery(queries.summary)).expenseTotal).toBe(5000);
    await Promise.all([client.fetchQuery(queries.entries), client.fetchQuery(queries.trend), client.fetchQuery(queries.categories)]);
    server.use(http.post(apiUrl("/api/imports/jobs/:id/commit"), () => {
      state.entries.push({ ...state.entries[0], id: "new-entry", source: "import", importBatchId: job.id });
      return HttpResponse.json({ ...job, status: "committed", result: { inserted: 1, skippedDuplicates: 0, failed: 0, errors: [] } });
    }));
    const user = userEvent.setup();
    renderWithProviders(<LedgerImportPage />, { queryClient: client });
    if (tab === "table") {
      await user.upload(screen.getByLabelText("가져올 파일"), new File(["이용일,가맹점,금액"], "generic.csv", { type: "text/csv" }));
    } else {
      await user.click(screen.getByRole("tab", { name: "PDF·이미지 명세서(AI)" }));
      await user.upload(await screen.findByLabelText("명세서 파일"), new File(["fake"], "generic.pdf", { type: "application/pdf" }));
      await user.click(screen.getByLabelText("AI로 명세서를 처리하는 데 동의합니다"));
      await user.click(screen.getByRole("button", { name: "명세서 추출하기" }));
    }
    await user.click(await screen.findByRole("button", { name: "매핑 확정" }));
    await user.click(await screen.findByRole("button", { name: "저장하기" }));
    await waitFor(() => expect(memoryRouter.router.push).toHaveBeenCalledWith("/ledger/import/review?batch=batch-1"));
    expect((await client.fetchQuery(queries.summary)).expenseTotal).toBe(10000);
    expect((await client.fetchQuery(queries.entries)).total).toBe(2);
    expect((await client.fetchQuery(queries.trend)).items.at(-1)?.expenseTotal).toBe(10000);
    await client.fetchQuery(queries.categories);
    expect(state.requests.filter((request) => request.startsWith("GET /api/ledger/categories"))).toHaveLength(2);
  });
  it("일반 파일 위저드를 거쳐 저장 후 리뷰로 이동한다", async () => {
    const requests = mockImports();
    const user = userEvent.setup();
    renderWithProviders(<LedgerImportPage />);
    await user.upload(screen.getByLabelText("가져올 파일"), new File(["이용일,가맹점,금액"], "generic.csv", { type: "text/csv" }));
    await user.click(await screen.findByRole("button", { name: "매핑 확정" }));
    await user.click(await screen.findByRole("button", { name: "저장하기" }));
    await waitFor(() => expect(memoryRouter.router.push).toHaveBeenCalledWith("/ledger/import/review?batch=batch-1"));
    expect(requests.find((r) => r.path === "upload")?.body).toContain("ledger_card");
  });

  it("로컬 처리 위치와 동의를 확인한 뒤 추출·매핑·저장한다", async () => {
    const requests = mockImports();
    const user = userEvent.setup();
    renderWithProviders(<LedgerImportPage />);
    await user.click(screen.getByRole("tab", { name: "PDF·이미지 명세서(AI)" }));
    expect(await screen.findByText(/명세서는 이 서버의 로컬 AI/)).toBeVisible();
    const submit = screen.getByRole("button", { name: "명세서 추출하기" });
    expect(submit).toBeDisabled();
    await user.upload(screen.getByLabelText("명세서 파일"), new File(["fake"], "generic.pdf", { type: "application/pdf" }));
    expect(submit).toBeDisabled();
    await user.click(screen.getByLabelText("AI로 명세서를 처리하는 데 동의합니다"));
    await user.click(submit);
    await user.click(await screen.findByRole("button", { name: "매핑 확정" }));
    expect(await screen.findByText("정상 1행 · 오류 0행")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "저장하기" }));
    await waitFor(() => expect(memoryRouter.router.push).toHaveBeenCalledWith("/ledger/import/review?batch=batch-1"));
    expect(requests.find((r) => r.path === "extract")?.body).toContain("true");
    expect(requests.find((r) => r.path === "commit")?.body).toEqual({ skipInvalid: true });
  });

  it("Gemini 공급자이면 외부 전송 문구를 표시한다", async () => {
    mockImports("gemini");
    const user = userEvent.setup();
    renderWithProviders(<LedgerImportPage />);
    await user.click(screen.getByRole("tab", { name: "PDF·이미지 명세서(AI)" }));
    expect(await screen.findByText("명세서 내용이 Google Gemini로 전송돼요.")).toBeVisible();
    expect(screen.queryByText(/외부로 보내지 않아요/)).not.toBeInTheDocument();
  });

  it("개인 AI가 꺼지면 추출 파일 입력을 보여주지 않는다", async () => {
    mockImports(null);
    const user = userEvent.setup();
    renderWithProviders(<LedgerImportPage />);
    await user.click(screen.getByRole("tab", { name: "PDF·이미지 명세서(AI)" }));
    expect(await screen.findByText(/AI 명세서 추출이 꺼져 있습니다/)).toBeVisible();
    expect(screen.queryByLabelText("명세서 파일")).not.toBeInTheDocument();
  });

  it("만료된 추출 작업은 파일을 다시 선택하도록 안내한다", async () => {
    mockImports();
    server.use(http.put(apiUrl("/api/imports/jobs/:id/mapping"), () => errorResponse(410, "IMPORT_JOB_EXPIRED", "만료됐습니다.")));
    const user = userEvent.setup();
    renderWithProviders(<ExtractedStatementWizard initialJob={job} onCommitted={() => {}} onReset={() => {}} />);
    await user.click(screen.getByRole("button", { name: "매핑 확정" }));
    expect(await screen.findByRole("button", { name: "파일 다시 선택" })).toBeVisible();
  });
});

it("리뷰에서 취소 표시, 단건 분류 변경과 같은 가맹점 일괄 변경", async () => {
  mockImports();
  const state = mockLedger([{ occurredOn: "2026-10-01", amount: 5000, category: "식비", merchant: "동네상점", source: "import" }]);
  Object.assign(state.entries[0], { isCancellation: true, importBatchId: "batch-1" });
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { staleTime: 30_000, retry: false } });
  const summaryQuery = { queryKey: ledgerKeys.summary("2026-10"), queryFn: () => getSummary("2026-10") };
  expect((await client.fetchQuery(summaryQuery)).byCategory[0].name).toBe("식비");
  let ruleBody: unknown;
  server.use(
    http.get(apiUrl("/api/imports/jobs/:id"), () => HttpResponse.json({ ...job, result: { inserted: 1, skippedDuplicates: 2, failed: 0, errors: [] } })),
    http.post(apiUrl("/api/ledger/merchant-rules"), async ({ request }) => { ruleBody = await request.json();
      const categoryId = (ruleBody as { categoryId: string }).categoryId;
      Object.assign(state.entries[0], { categoryId, categoryName: state.categories.find((category) => category.id === categoryId)?.name });
      return HttpResponse.json({ updatedCount: 1 }); }),
  );
  const user = userEvent.setup();
  renderWithProviders(<LedgerImportReview />, { route: "/ledger/import/review?batch=batch-1", queryClient: client });
  expect(await screen.findByText("취소 거래")).toBeVisible();
  expect(screen.getByText("저장 1건 · 중복 2건 · 실패 0건")).toBeVisible();
  await user.click(screen.getByRole("combobox", { name: "카테고리" }));
  await user.click(screen.getByRole("option", { name: "교통" }));
  await waitFor(() => expect(state.bodies.some((b) => b.method === "PATCH" && (b.body as { categoryId: string }).categoryId === "cat-e3")).toBe(true));
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  expect((await client.fetchQuery(summaryQuery)).byCategory[0].name).toBe("교통");
  await user.click(screen.getByLabelText("같은 가맹점 모두 바꾸기"));
  await user.click(screen.getByRole("combobox", { name: "카테고리" }));
  await user.click(screen.getByRole("option", { name: "쇼핑" }));
  await waitFor(() => expect(ruleBody).toEqual({ merchant: "동네상점", categoryId: "cat-e5", applyToExisting: true }));
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  expect((await client.fetchQuery(summaryQuery)).byCategory[0].name).toBe("쇼핑");
  expect(state.requests.filter((request) => request.startsWith("GET /api/ledger/categories")).length).toBeGreaterThanOrEqual(3);
  expect(state.requests.some((request) => request.includes("importBatchId=batch-1") && !request.includes("month="))).toBe(true);
});
