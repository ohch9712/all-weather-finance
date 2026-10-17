import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { DataConnectionsSection } from "@/features/connectors/components/DataConnectionsSection";
import { API_BASE_URL } from "@/lib/api-client";
import { renderWithProviders, server } from "../utils";

const root = `${API_BASE_URL}/api/connectors`;
const mydata = "마이데이터는 금융위원회 허가를 받은 본인신용정보관리업자만 쓸 수 있어 개인 프로젝트에서는 연동할 수 없습니다.";
const account = { id: "test-account", provider: "codef", kind: "card", organization: "0306", organizationName: "신한카드", label: "생활 카드", createdAt: "2026-10-17T00:00:00Z" };
const succeeded = { id: "test-sync", accountId: account.id, kind: "card_approvals", status: "succeeded", rangeStart: "2026-10-01", rangeEnd: "2026-10-17", startedAt: "2026-10-17T00:00:00Z", finishedAt: "2026-10-17T00:01:00Z", summary: { inserted: 2, skippedDuplicates: 1, failed: 0, errors: [] }, errorCode: null };
function handlers({ available = true, accounts = [] as object[], syncs = [] as object[] } = {}) {
  server.use(
    http.get(`${root}/providers`, () => HttpResponse.json({ items: [{ key: "codef", available, environment: "sandbox", note: "은행은 기관에 따라 아이디 로그인이 막힐 수 있어요." }, { key: "mydata", available: false, note: mydata }] })),
    http.get(`${root}/accounts`, () => HttpResponse.json({ items: accounts })),
    http.get(`${root}/organizations`, ({ request }) => HttpResponse.json({ items: new URL(request.url).searchParams.get("kind") === "card" ? [{ code: "0306", name: "신한카드" }] : [{ code: "0004", name: "KB국민" }] })),
    http.get(`${root}/syncs`, () => HttpResponse.json({ items: syncs, total: syncs.length, page: 1, pageSize: 20 })),
    http.get(`${API_BASE_URL}/api/ai/status`, () => HttpResponse.json({ personal: { enabled: false, provider: null, location: null, model: null, reason: "not_configured" } })),
  );
}

describe("데이터 자동 수집", () => {
  it("마이데이터 제약·키 없음·샌드박스 고지를 보여 준다", async () => {
    handlers({ available: false });
    renderWithProviders(<DataConnectionsSection />);
    expect(await screen.findByText(mydata)).toBeInTheDocument();
    expect(await screen.findByText("키 설정 필요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수집 계정 추가" })).toBeDisabled();
    expect(screen.getByText("샌드박스")).toBeInTheDocument();
    expect(screen.getByText("샘플 데이터입니다. 실제 시세가 아닙니다.")).toBeInTheDocument();
  });
  it("전송 동의를 받고 계정을 등록하며 로그인 정보는 성공 뒤 폼에 남기지 않는다", async () => {
    handlers();
    let sent: Record<string, unknown> | undefined;
    server.use(http.post(`${root}/accounts`, async ({ request }) => { sent = await request.json() as Record<string, unknown>; return HttpResponse.json(account, { status: 201 }); }));
    renderWithProviders(<DataConnectionsSection />);
    await waitFor(() => expect(screen.getByRole("button", { name: "수집 계정 추가" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "수집 계정 추가" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "신한카드" });
    fireEvent.change(within(dialog).getByLabelText("기관"), { target: { value: "0306" } });
    fireEvent.change(within(dialog).getByLabelText("별칭"), { target: { value: "생활 카드" } });
    fireEvent.change(within(dialog).getByLabelText("로그인 아이디"), { target: { value: "test-login" } });
    fireEvent.change(within(dialog).getByLabelText("로그인 비밀번호"), { target: { value: "test-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "계정 연결" }));
    expect(await within(dialog).findByText("로그인 정보 전송에 동의해 주세요.")).toBeInTheDocument();
    expect(sent).toBeUndefined();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "계정 연결" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent).toEqual({ provider: "codef", kind: "card", organization: "0306", label: "생활 카드", loginId: "test-login", password: "test-password", consent: true });
    fireEvent.click(screen.getByRole("button", { name: "수집 계정 추가" }));
    expect(await screen.findByLabelText("로그인 아이디")).toHaveValue("");
    expect(screen.getByLabelText("로그인 비밀번호")).toHaveValue("");
  });
  it("실패한 등록 뒤에도 로그인 입력을 지우고 은행 안내를 보여 준다", async () => {
    handlers();
    server.use(http.post(`${root}/accounts`, () => HttpResponse.json({ error: { code: "CONNECTOR_FAILED", message: "연결하지 못했습니다.", details: [] } }, { status: 502 })));
    renderWithProviders(<DataConnectionsSection />);
    await waitFor(() => expect(screen.getByRole("button", { name: "수집 계정 추가" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "수집 계정 추가" }));
    fireEvent.change(await screen.findByLabelText("종류"), { target: { value: "bank" } });
    await screen.findByRole("option", { name: "KB국민" });
    fireEvent.change(screen.getByLabelText("기관"), { target: { value: "0004" } });
    fireEvent.change(screen.getByLabelText("별칭"), { target: { value: "통장" } });
    fireEvent.change(screen.getByLabelText("로그인 아이디"), { target: { value: "test-login" } });
    fireEvent.change(screen.getByLabelText("로그인 비밀번호"), { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "계정 연결" }));
    expect(await screen.findByText("연결하지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("로그인 아이디")).toHaveValue("");
    expect(screen.getByLabelText("로그인 비밀번호")).toHaveValue("");
    expect(within(screen.getByRole("dialog")).getByText("은행은 기관에 따라 아이디 로그인이 막힐 수 있어요.")).toBeInTheDocument();
  });
  it("카드 기간을 검증하고 결과·가계부 링크를 보여 준다", async () => {
    handlers({ accounts: [account] });
    let sent: unknown;
    server.use(http.post(`${root}/sync`, async ({ request }) => {
      sent = await request.json();
      server.use(http.get(`${root}/syncs`, () => HttpResponse.json({ items: [succeeded], page: 1, pageSize: 20, total: 1 })));
      return HttpResponse.json(succeeded);
    }));
    renderWithProviders(<DataConnectionsSection />);
    await screen.findByText("생활 카드");
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-05-01" } });
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("최대 92일");
    expect(sent).toBeUndefined();
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    expect(await screen.findByText("저장 2건 · 중복 1건 · 실패 0건")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "가계부에서 보기" })).toHaveAttribute("href", "/ledger/import/review?batch=test-sync");
    expect(sent).toEqual({ accountId: account.id, from: "2026-09-01", to: "2026-09-30" });
  });
  it("은행 결과와 삭제 확인을 제공한다", async () => {
    const bank = { ...account, kind: "bank", organizationName: "KB국민" };
    handlers({ accounts: [bank], syncs: [{ ...succeeded, kind: "bank_balances", summary: { created: 1, updated: 2, removed: 0, skipped: [], syncedAt: succeeded.finishedAt } }] });
    let removed = false;
    server.use(http.delete(`${root}/accounts/${account.id}`, () => { removed = true; return new HttpResponse(null, { status: 204 }); }));
    renderWithProviders(<DataConnectionsSection />);
    expect(await screen.findByText("추가 1건 · 갱신 2건 · 삭제 0건")).toBeInTheDocument();
    expect(screen.queryByLabelText("시작일")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("이 연결에서 가져온 현금 자산을 삭제");
    fireEvent.click(screen.getByRole("button", { name: "계정 삭제" }));
    await waitFor(() => expect(removed).toBe(true));
  });
  it("계정을 삭제하면 그 계정의 이력은 다시 부르지 않고 캐시에서 지우며 남은 계정은 갱신한다", async () => {
    const bank = { ...account, id: "other-account", kind: "bank", organization: "0004", organizationName: "KB국민", label: "월급 통장" };
    const bankSync = { ...succeeded, id: "bank-sync", accountId: bank.id, kind: "bank_balances", rangeStart: null, rangeEnd: null, summary: { created: 1, updated: 2, removed: 0, skipped: [], syncedAt: succeeded.finishedAt } };
    let deleted = false;
    const afterDelete = { accounts: 0, syncs: [] as string[] };
    handlers();
    server.use(
      http.get(`${root}/accounts`, () => {
        if (deleted) afterDelete.accounts += 1;
        return HttpResponse.json({ items: deleted ? [bank] : [account, bank] });
      }),
      http.get(`${root}/syncs`, ({ request }) => {
        const id = new URL(request.url).searchParams.get("accountId") ?? "";
        if (deleted) afterDelete.syncs.push(id);
        if (deleted && id === account.id) return HttpResponse.json({ error: { code: "NOT_FOUND", message: "찾을 수 없습니다.", details: [] } }, { status: 404 });
        return HttpResponse.json({ items: [id === account.id ? succeeded : bankSync], page: 1, pageSize: 20, total: 1 });
      }),
      http.delete(`${root}/accounts/${account.id}`, () => { deleted = true; return new HttpResponse(null, { status: 204 }); }),
    );
    const { queryClient } = renderWithProviders(<DataConnectionsSection />);
    for (const name of ["ledger", "allocation", "dashboard"]) queryClient.setQueryData([name, "test"], { items: [] });
    expect(await screen.findByText("저장 2건 · 중복 1건 · 실패 0건")).toBeInTheDocument();
    expect(await screen.findByText("추가 1건 · 갱신 2건 · 삭제 0건")).toBeInTheDocument();
    const card = screen.getByText("생활 카드").closest("[data-slot=card]") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "삭제" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "계정 삭제" }));
    await waitFor(() => expect(screen.queryByText("생활 카드")).not.toBeInTheDocument());
    // 삭제 처리(갱신 요청 포함)가 모두 끝난 뒤 요청 기록을 확인한다.
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(afterDelete.syncs).not.toContain(account.id);
    expect(afterDelete.syncs).toContain(bank.id);
    expect(afterDelete.accounts).toBeGreaterThan(0);
    await waitFor(() => expect(queryClient.getQueryState(["connectors", "syncs", account.id])).toBeUndefined());
    for (const name of ["ledger", "allocation", "dashboard"]) expect(queryClient.getQueryState([name, "test"])?.isInvalidated).toBe(true);
    expect(screen.getByText("월급 통장")).toBeInTheDocument();
    expect(screen.getByText("추가 1건 · 갱신 2건 · 삭제 0건")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("실패 이력과 API 오류를 안내한다", async () => {
    handlers({ accounts: [account], syncs: [{ ...succeeded, status: "failed", summary: null, errorCode: "CF-03002" }] });
    renderWithProviders(<DataConnectionsSection />);
    expect(await screen.findByText(/CF-03002/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "가계부에서 보기" })).not.toBeInTheDocument();
  });
});
