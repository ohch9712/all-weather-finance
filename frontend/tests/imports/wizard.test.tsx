import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, it, vi } from "vitest";
import { ImportWizard } from "@/features/imports";
import type { ImportJob, ImportPreview } from "@/features/imports/types";
import { apiUrl, errorResponse, renderWithProviders, server } from "../utils";
const fields = [
  { key: "date", label: "날짜", type: "date" as const, required: true },
  { key: "amount", label: "금액", type: "amount" as const, required: true },
  { key: "title", label: "제목", type: "text" as const, required: true },
];
const preview: ImportPreview = { validCount: 1, invalidCount: 1, page: 1, pageSize: 50, total: 2, rows: [
  { rowNumber: 2, values: { date: "2026-10-16", amount: 12000, title: "식사" }, errors: [] },
  { rowNumber: 3, values: { date: "2026-10-16", title: "오류 데이터" }, errors: [{ rowNumber: 3, field: "amount", message: "금액 형식이 아닙니다." }] },
] };
const job: ImportJob = { id: "job-1", kind: "demo", status: "parsed", fileName: "demo.csv", fileType: "csv", sheetNames: ["Sheet1"], sheetName: "Sheet1", headerRow: 1, fields, columns: fields.map((f, index) => ({ index, header: f.label, samples: ["예시"] })), mapping: { date: 0, amount: 1, title: 2 }, mappingSource: "synonym", presetKey: null, rowCount: 2, skippedRowCount: 0, warnings: [], expiresAt: "2026-10-18T00:00:00Z", preview: null, result: null };
function setup(overrides: Partial<ImportJob> = {}) {
  let current = { ...job, ...overrides };
  const requests: unknown[] = [];
  const previewRequest = vi.fn();
  const committedPreviewRequest = vi.fn();
  server.use(
    http.get(apiUrl("/api/ai/status"), () => HttpResponse.json({ personal: { enabled: true, provider: "ollama", location: "local", model: "test", reason: null } })),
    http.post(apiUrl("/api/imports/jobs"), () => HttpResponse.json(current, { status: 201 })),
    http.put(apiUrl("/api/imports/jobs/job-1/mapping"), async ({ request }) => { requests.push(await request.json()); current = { ...current, status: "mapped", preview }; return HttpResponse.json(current); }),
    http.get(apiUrl("/api/imports/jobs/job-1/preview"), () => {
      previewRequest();
      if (current.status === "committed") {
        committedPreviewRequest();
        return errorResponse(409, "CONFLICT", "이미 저장한 업로드입니다.");
      }
      return HttpResponse.json(preview);
    }),
    http.post(apiUrl("/api/imports/jobs/job-1/commit"), async ({ request }) => { requests.push(await request.json()); current = { ...current, status: "committed", preview: null, result: { inserted: 1, skippedDuplicates: 0, failed: 1, errors: preview.rows[1].errors } }; return HttpResponse.json(current); }),
    http.delete(apiUrl("/api/imports/jobs/job-1"), () => new HttpResponse(null, { status: 204 })),
  );
  const onCommitted = vi.fn();
  return { ...renderWithProviders(<ImportWizard kind="demo" title="테스트 가져오기" description="가짜 표를 올려 주세요." onCommitted={onCommitted} />), onCommitted, requests, previewRequest, committedPreviewRequest };
}
async function upload(user: ReturnType<typeof setup>["user"]) {
  await user.upload(screen.getByLabelText("가져올 파일"), new File(["날짜,금액,제목\n2026-10-16,12000,식사"], "demo.csv", { type: "text/csv" }));
}
it("4단계 진행과 오류 행 및 결과를 표시한다", async () => {
  const { user, onCommitted, requests } = setup(); await upload(user);
  expect(await screen.findByText("자동 인식")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "매핑 확정" }));
  expect(await screen.findByText("정상 1행 · 오류 1행")).toBeInTheDocument();
  expect(screen.getByText("금액: 금액 형식이 아닙니다.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(await screen.findByText("저장 1건 · 중복 0건 · 실패 1건")).toBeInTheDocument();
  expect(onCommitted).toHaveBeenCalledOnce();
  expect(requests).toEqual([{ mapping: job.mapping }, { skipInvalid: true }]);
});
it("저장 후 미리보기를 재요청하지 않고 작업 캐시와 결과를 갱신한다", async () => {
  const { user, queryClient, onCommitted, previewRequest, committedPreviewRequest } = setup();
  await upload(user);
  await user.click(await screen.findByRole("button", { name: "매핑 확정" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "저장하기" })).toBeEnabled());
  expect(previewRequest).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(await screen.findByText("저장 1건 · 중복 0건 · 실패 1건")).toBeInTheDocument();
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  expect(committedPreviewRequest).not.toHaveBeenCalled();
  expect(previewRequest).toHaveBeenCalledOnce();
  expect(queryClient.getQueryData<ImportJob>(["imports", "job", job.id])?.status).toBe("committed");
  expect(onCommitted).toHaveBeenCalledOnce();
});
it("열 매핑을 다시 확정하면 미리보기를 갱신한다", async () => {
  const { user, previewRequest } = setup();
  await upload(user);
  await user.click(await screen.findByRole("button", { name: "매핑 확정" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "저장하기" })).toBeEnabled());
  expect(previewRequest).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "열 매핑 수정" }));
  await user.click(screen.getByRole("button", { name: "매핑 확정" }));
  await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "저장하기" })).toBeEnabled());
});
it("필수 필드 미매핑이면 확정할 수 없다", async () => {
  const { user } = setup({ mapping: { date: 0, amount: null, title: 2 } }); await upload(user);
  expect(await screen.findByRole("button", { name: "매핑 확정" })).toBeDisabled();
});
it("오류 제외를 끄면 오류가 있는 표는 저장할 수 없다", async () => {
  const { user } = setup(); await upload(user);
  await user.click(await screen.findByRole("button", { name: "매핑 확정" }));
  await screen.findByText("정상 1행 · 오류 1행");
  await user.click(screen.getByRole("switch", { name: "오류 행 제외하고 저장" }));
  expect(screen.getByRole("button", { name: "저장하기" })).toBeDisabled();
});
it("410이면 파일 선택으로 돌아간다", async () => {
  const { user } = setup(); await upload(user);
  server.use(http.put(apiUrl("/api/imports/jobs/job-1/mapping"), () => errorResponse(410, "IMPORT_JOB_EXPIRED", "업로드한 지 24시간이 지났습니다. 파일을 다시 올려 주세요.")));
  await user.click(await screen.findByRole("button", { name: "매핑 확정" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("파일을 다시 올려 주세요.");
  expect(screen.getByRole("button", { name: "파일 선택" })).toBeEnabled();
});
it("미리보기 만료도 재시작을 안내한다", async () => {
  const { user } = setup(); await upload(user);
  server.use(http.get(apiUrl("/api/imports/jobs/job-1/preview"), () => errorResponse(410, "IMPORT_JOB_EXPIRED", "만료")));
  await user.click(await screen.findByRole("button", { name: "매핑 확정" }));
  await user.click(await screen.findByRole("button", { name: "파일 다시 선택" }));
  expect(screen.getByRole("button", { name: "파일 선택" })).toBeInTheDocument();
});
it("AI 추천에는 공급자와 고지가 붙고 다중 시트는 선택 뒤 진행한다", async () => {
  const { user } = setup({ mappingSource: "llm", sheetNames: ["Sheet1", "Sheet2"] }); await upload(user);
  expect(await screen.findByLabelText("시트 선택")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "열 매핑으로" }));
  expect(screen.getByText("AI 추천")).toBeInTheDocument();
  expect(await screen.findAllByText("로컬 AI")).toHaveLength(2);
  expect(screen.getByRole("note")).toHaveTextContent("AI 답변은 틀릴 수 있습니다.");
});
