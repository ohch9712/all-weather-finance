import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(screen.getByText("이 앱에는 연결 식별값만 암호화해 저장해요. 로그인 정보는 CODEF가 암호화해 보관하고, 연결을 삭제하면 함께 지워져요.")).toBeInTheDocument();
    expect(screen.getByText("샘플 데이터입니다. 실제 시세가 아닙니다.")).toBeInTheDocument();
  });
  it("등록 동의를 받고 계정을 등록하며 로그인 정보는 성공 뒤 폼에 남기지 않는다", async () => {
    handlers();
    let sent: Record<string, unknown> | undefined;
    server.use(http.post(`${root}/accounts`, async ({ request }) => { sent = await request.json() as Record<string, unknown>; return HttpResponse.json(account, { status: 201 }); }));
    renderWithProviders(<DataConnectionsSection />);
    await waitFor(() => expect(screen.getByRole("button", { name: "수집 계정 추가" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "수집 계정 추가" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("로그인 정보 처리 방식")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem").map(item => item.textContent)).toEqual([
      "이 앱은 아이디·비밀번호를 저장하지 않습니다. 비밀번호는 암호화해 CODEF로 보냅니다.",
      "로그인 정보는 CODEF에 등록되고, CODEF는 이를 AES-256 등으로 암호화해 보관합니다. 연결할 때와 '가져오기'를 누를 때만 이 정보로 금융사에 로그인합니다.",
      "이 앱은 카드 승인내역과 계좌 잔액 조회만 요청합니다. 결제·이체 기능은 없습니다.",
      "연결을 삭제하면 CODEF에 등록된 로그인 정보도 즉시 삭제됩니다. 금융사 비밀번호를 바꿔도 등록된 정보로는 더 이상 로그인할 수 없습니다.",
      "CODEF는 서비스 품질 관리와 문의 대응을 위해 조회 요청·응답 기록을 보관합니다. 이 기록은 연결을 삭제해도 남으며, 이 앱과 CODEF의 이용 계약이 끝나면 일괄 삭제됩니다.",
    ]);
    const policy = within(dialog).getByRole("link", { name: "CODEF 보안 정책 보기" });
    expect(policy).toHaveAttribute("href", "https://codef.io/legal/security");
    expect(policy).toHaveAttribute("target", "_blank");
    expect(policy).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(dialog).getByRole("checkbox", { name: "위 내용을 확인했고, 금융사 로그인 정보를 CODEF에 등록하는 데 동의합니다." })).toBeInTheDocument();
    await within(dialog).findByRole("option", { name: "신한카드" });
    fireEvent.change(within(dialog).getByLabelText("기관"), { target: { value: "0306" } });
    fireEvent.change(within(dialog).getByLabelText("별칭"), { target: { value: "생활 카드" } });
    fireEvent.change(within(dialog).getByLabelText("로그인 아이디"), { target: { value: "test-login" } });
    fireEvent.change(within(dialog).getByLabelText("로그인 비밀번호"), { target: { value: "test-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "계정 연결" }));
    expect(await within(dialog).findByText("안내 내용을 확인하고 동의해 주세요.")).toBeInTheDocument();
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
    expect(screen.queryByText("실패 이유")).not.toBeInTheDocument();
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
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("연결과 CODEF에 등록된 로그인 정보, 이 연결에서 가져온 현금 자산을 삭제합니다.");
    fireEvent.click(screen.getByRole("button", { name: "계정 삭제" }));
    await waitFor(() => expect(removed).toBe(true));
  });
  it.each([false, true])("계정 삭제 뒤 캐시를 정리한다(localOnly=%s)", async (localOnly) => {
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
      http.delete(`${root}/accounts/${account.id}`, ({ request }) => { if (localOnly && !new URL(request.url).searchParams.has("localOnly")) return HttpResponse.json({ error: { code: "CONFLICT", message: "CODEF 삭제 실패", details: [] } }, { status: 409 }); deleted = true; return new HttpResponse(null, { status: 204 }); }),
    );
    const { queryClient } = renderWithProviders(<DataConnectionsSection />);
    for (const name of ["ledger", "allocation", "dashboard"]) queryClient.setQueryData([name, "test"], { items: [] });
    expect(await screen.findByText("저장 2건 · 중복 1건 · 실패 0건")).toBeInTheDocument();
    expect(await screen.findByText("추가 1건 · 갱신 2건 · 삭제 0건")).toBeInTheDocument();
    const card = screen.getByText("생활 카드").closest("[data-slot=card]") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "삭제" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "계정 삭제" }));
    if (localOnly) {
      fireEvent.click(await screen.findByRole("button", { name: "이 앱에서만 삭제" }));
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "이 앱에서만 삭제" }));
    }
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
  it("카드 실패 이유를 응답 순번과 함께 최대 5건 보여 주고 나머지는 외 N건으로 줄인다", async () => {
    const masked = "값이 가려져 있어 읽을 수 없습니다.";
    const errors = [
      { rowNumber: 2, field: "resUsedDate", message: masked },
      { rowNumber: 3, field: null, message: "금액을 확인해 주세요." },
      { rowNumber: 5, field: "resMemberStoreName", message: "가맹점명이 비어 있습니다." },
      { rowNumber: 6, field: "resKRWAmt", message: "해외 이용 건의 원화 금액이 없습니다." },
      { rowNumber: 8, field: "resCancelAmount", message: "취소금액을 읽을 수 없습니다." },
      { rowNumber: 9, field: "resUsedAmount", message: masked },
      { rowNumber: 10, field: "resUsedAmount", message: "이용금액을 읽을 수 없습니다." },
    ];
    handlers({ accounts: [account], syncs: [{ ...succeeded, summary: { inserted: 1, skippedDuplicates: 0, failed: 9, errors } }] });
    renderWithProviders(<DataConnectionsSection />);
    expect(await screen.findByText("저장 1건 · 중복 0건 · 실패 9건")).toBeInTheDocument();
    const reasons = screen.getByText("실패 이유").parentElement as HTMLElement;
    expect(within(reasons).getAllByRole("listitem").map(item => item.textContent)).toEqual([
      `2번째 승인 내역: ${masked}`,
      "3번째 승인 내역: 금액을 확인해 주세요.",
      "5번째 승인 내역: 가맹점명이 비어 있습니다.",
      "6번째 승인 내역: 해외 이용 건의 원화 금액이 없습니다.",
      "8번째 승인 내역: 취소금액을 읽을 수 없습니다.",
    ]);
    expect(within(reasons).getByText("외 4건")).toBeInTheDocument();
    expect(screen.queryByText(/9번째 승인 내역/)).not.toBeInTheDocument();
    expect(screen.queryByText("실패 이유가 기록되지 않은 이전 가져오기입니다.")).not.toBeInTheDocument();
  });
  it("실패 이유를 모두 보여 줄 수 있으면 외 N건을 붙이지 않는다", async () => {
    const errors = [{ rowNumber: 1, field: "resUsedDate", message: "값이 가려져 있어 읽을 수 없습니다." }];
    handlers({ accounts: [account], syncs: [{ ...succeeded, summary: { inserted: 0, skippedDuplicates: 0, failed: 1, errors } }] });
    renderWithProviders(<DataConnectionsSection />);
    expect(await screen.findByText("1번째 승인 내역: 값이 가려져 있어 읽을 수 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/^외 \d+건$/)).not.toBeInTheDocument();
  });
  it("실패 이유가 없는 이전 가져오기 이력은 안내 문구를 보여 준다", async () => {
    handlers({ accounts: [account], syncs: [{ ...succeeded, summary: { inserted: 0, skippedDuplicates: 0, failed: 1, errors: [] } }] });
    renderWithProviders(<DataConnectionsSection />);
    expect(await screen.findByText("실패 이유가 기록되지 않은 이전 가져오기입니다.")).toBeInTheDocument();
    expect(screen.getByText("실패 이유")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
  it("실패 이력과 API 오류를 안내한다", async () => {
    handlers({ accounts: [account], syncs: [{ ...succeeded, status: "failed", summary: null, errorCode: "CF-03002" }] });
    renderWithProviders(<DataConnectionsSection />);
    expect(await screen.findByText(/CF-03002/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "가계부에서 보기" })).not.toBeInTheDocument();
  });
});


describe("삭제 실패 처리", () => {
  it.each([
    [502, "CONNECTOR_FAILED", "card"],
    [409, "CONFLICT", "bank"],
  ])("%s 실패 후 확인하면 로컬 삭제한다(%s, %s)", async (status, code, kind) => {
    let deleted = false;
    const requests: string[] = [];
    handlers({ accounts: [{ ...account, kind }] });
    server.use(
      http.get(`${root}/accounts`, () => HttpResponse.json({ items: deleted ? [] : [{ ...account, kind }] })),
      http.delete(`${root}/accounts/${account.id}`, ({ request }) => {
        requests.push(request.url);
        if (new URL(request.url).searchParams.get("localOnly") === "true") {
          deleted = true;
          return new HttpResponse(null, { status: 204 });
        }
        return HttpResponse.json({ error: { code, message: "서버에서 전한 삭제 오류", details: [] } }, { status: Number(status) });
      }),
    );
    renderWithProviders(<DataConnectionsSection />);
    await screen.findByText("생활 카드");
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(kind === "bank" ? "연결과 CODEF에 등록된 로그인 정보, 이 연결에서 가져온 현금 자산을 삭제합니다." : "연결과 CODEF에 등록된 로그인 정보를 삭제합니다. 이미 기록한 가계부 내역은 유지됩니다.");
    fireEvent.click(within(dialog).getByRole("button", { name: "계정 삭제" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("서버에서 전한 삭제 오류");
    fireEvent.click(await screen.findByRole("button", { name: "이 앱에서만 삭제" }));
    const localDialog = await screen.findByRole("alertdialog");
    expect(localDialog).toHaveTextContent("이 앱에서만 삭제할까요?");
    expect(localDialog).toHaveTextContent("CODEF에 등록된 로그인 정보는 남을 수 있습니다. 금융사 비밀번호를 바꾸면 남은 정보로는 로그인할 수 없습니다." + (kind === "bank" ? " 이 연결에서 가져온 현금 자산도 삭제합니다." : ""));
    const confirm = within(localDialog).getByRole("button", { name: "이 앱에서만 삭제" });
    expect(confirm).toHaveAttribute("data-variant", "destructive");
    expect(requests).toHaveLength(1);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByText("생활 카드")).not.toBeInTheDocument());
    expect(new URL(requests[1]).searchParams.get("localOnly")).toBe("true");
    expect(screen.queryByRole("button", { name: "이 앱에서만 삭제" })).not.toBeInTheDocument();
  });

  it.each([[500, "INTERNAL_ERROR"], [502, "OTHER_ERROR"], [409, "OTHER_ERROR"], [404, "NOT_FOUND"], [0, "NETWORK_ERROR"]])("다른 삭제 오류 %s %s에는 로컬 삭제를 보여 주지 않는다", async (status, code) => {
    handlers({ accounts: [account] });
    server.use(http.delete(`${root}/accounts/${account.id}`, () => status === 0 ? HttpResponse.error() : HttpResponse.json({ error: { code, message: "삭제 오류", details: [] } }, { status })));
    renderWithProviders(<DataConnectionsSection />);
    await screen.findByText("생활 카드");
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "계정 삭제" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "이 앱에서만 삭제" })).not.toBeInTheDocument();
  });
});


describe("로그인 정보 안내 박스 스크롤", () => {
  afterEach(() => vi.restoreAllMocks());
  const regionName = "로그인 정보 처리 방식 내용";
  async function openForm() {
    handlers();
    renderWithProviders(<DataConnectionsSection />);
    await waitFor(() => expect(screen.getByRole("button", { name: "수집 계정 추가" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "수집 계정 추가" }));
    return screen.findByRole("dialog");
  }

  it("다섯 항목만 키보드로 스크롤할 수 있는 영역에 두고 제목과 링크는 밖에 둔다", async () => {
    const dialog = await openForm();
    const aside = within(dialog).getByRole("complementary", { name: "로그인 정보 처리 방식" });
    const region = within(aside).getByRole("region", { name: regionName });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getAllByRole("listitem")).toHaveLength(5);
    const heading = within(aside).getByRole("heading", { name: "로그인 정보 처리 방식" });
    const policy = within(aside).getByRole("link", { name: "CODEF 보안 정책 보기" });
    expect(region).not.toContainElement(heading);
    expect(region).not.toContainElement(policy);
    // jsdom은 레이아웃이 없어 높이가 0이므로 넘치는 내용이 없고 흐림 처리도 없다.
    expect(within(dialog).queryByTestId("login-info-fade")).not.toBeInTheDocument();
  });

  it("아래에 내용이 더 있으면 흐림 처리를 보여 주고 끝까지 스크롤하면 없앤다", async () => {
    // 목록 영역만 내용 300px, 보이는 높이 144px(9rem)로 둔다.
    const sizeOf = (height: number) => function (this: Element) { return this.getAttribute("aria-label") === regionName ? height : 0; };
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(sizeOf(300));
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(sizeOf(144));
    const dialog = await openForm();
    const region = within(dialog).getByRole("region", { name: regionName });
    const fade = await within(dialog).findByTestId("login-info-fade");
    expect(fade).toHaveAttribute("aria-hidden", "true");
    expect(fade).toHaveClass("pointer-events-none");
    expect(region).not.toContainElement(fade);
    const scrollTo = (top: number) => {
      Object.defineProperty(region, "scrollTop", { configurable: true, value: top });
      fireEvent.scroll(region);
    };
    scrollTo(100);
    expect(within(dialog).getByTestId("login-info-fade")).toBeInTheDocument();
    // 끝에서 1px 모자란 값은 반올림 오차로 보고 끝으로 친다.
    scrollTo(155);
    await waitFor(() => expect(within(dialog).queryByTestId("login-info-fade")).not.toBeInTheDocument());
    scrollTo(20);
    expect(await within(dialog).findByTestId("login-info-fade")).toBeInTheDocument();
    scrollTo(156);
    await waitFor(() => expect(within(dialog).queryByTestId("login-info-fade")).not.toBeInTheDocument());
  });
});
