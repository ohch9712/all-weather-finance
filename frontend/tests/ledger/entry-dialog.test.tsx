import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import LedgerRoute from "@/app/(app)/ledger/page";
import { todayKst } from "@/features/ledger/utils";
import { apiUrl, errorResponse, renderWithProviders, server } from "../utils";
import { OCTOBER_SEED, mockLedger } from "./mock-ledger";

function renderLedger() {
  return renderWithProviders(<LedgerRoute />, { route: "/ledger?month=2026-10" });
}

function entriesRegion() {
  return screen.getByRole("region", { name: "내역" });
}

function expenseCardValue() {
  const card = screen.getByText("지출", { selector: "[data-slot=card-title]" }).closest("[data-slot=card]") as HTMLElement;
  return within(card).getByText(/원$/).textContent;
}

async function chooseOption(dialog: HTMLElement, label: string, option: string, user: ReturnType<typeof renderLedger>["user"]) {
  await user.click(within(dialog).getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("내역 추가·수정·삭제", () => {
  it("내역을 추가하면 목록·요약·추이를 다시 불러온다", async () => {
    const ledger = mockLedger(OCTOBER_SEED);
    const { user } = renderLedger();
    await within(await screen.findByRole("region", { name: "내역" })).findByRole("button", { name: /관리사무소/ });
    await waitFor(() => expect(expenseCardValue()).toBe("1,820,000원"));
    const summaryRequests = () => ledger.requests.filter((request) => request.startsWith("GET /api/ledger/summary")).length;
    const trendRequests = () => ledger.requests.filter((request) => request.startsWith("GET /api/ledger/trend")).length;
    const before = { summary: summaryRequests(), trend: trendRequests() };

    await user.click(screen.getByRole("button", { name: "내역 추가" }));
    const dialog = await screen.findByRole("dialog", { name: "내역 추가" });
    // 기본값: 지출, 오늘(KST), 카드
    expect(within(dialog).getByRole("radio", { name: "지출" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByLabelText("날짜")).toHaveValue(todayKst());
    expect(within(dialog).getByRole("combobox", { name: "결제수단" })).toHaveTextContent("카드");

    fireEvent.change(within(dialog).getByLabelText("날짜"), { target: { value: "2026-10-16" } });
    const amount = within(dialog).getByLabelText("금액");
    await user.type(amount, "12000");
    expect(amount).toHaveValue("12,000");
    await chooseOption(dialog, "카테고리", "식비", user);
    await user.type(within(dialog).getByLabelText("사용처"), " 김밥천국 ");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(ledger.bodies.at(-1)).toEqual({
      method: "POST",
      path: "/api/ledger/entries",
      body: {
        kind: "expense",
        occurredOn: "2026-10-16",
        amount: 12000,
        categoryId: "cat-e1",
        merchant: "김밥천국",
        paymentMethod: "card",
        memo: null,
      },
    });
    const row = await within(entriesRegion()).findByRole("button", { name: /김밥천국/ });
    expect(within(row).getByText("-12,000원")).toBeInTheDocument();
    await waitFor(() => expect(expenseCardValue()).toBe("1,832,000원"));
    expect(summaryRequests()).toBeGreaterThan(before.summary);
    expect(trendRequests()).toBeGreaterThan(before.trend);
  });

  it("수입으로 바꾸면 수입 카테고리만 보이고 결제수단 기본값이 계좌이체가 된다", async () => {
    const ledger = mockLedger();
    const { user } = renderLedger();
    await user.click(await screen.findByRole("button", { name: "내역 추가" }));
    const dialog = await screen.findByRole("dialog", { name: "내역 추가" });
    await chooseOption(dialog, "카테고리", "식비", user);

    await user.click(within(dialog).getByRole("radio", { name: "수입" }));
    // 종류와 맞지 않는 카테고리는 지운다.
    expect(within(dialog).getByRole("combobox", { name: "카테고리" })).toHaveTextContent("카테고리 선택");
    expect(within(dialog).getByRole("combobox", { name: "결제수단" })).toHaveTextContent("계좌이체");
    await user.click(within(dialog).getByRole("combobox", { name: "카테고리" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["급여", "상여", "기타 수입"]);
    await user.click(screen.getByRole("option", { name: "급여" }));
    await user.type(within(dialog).getByLabelText("금액"), "3000000");
    fireEvent.change(within(dialog).getByLabelText("날짜"), { target: { value: "2026-10-25" } });
    await user.type(within(dialog).getByLabelText("메모"), "10월 월급");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(ledger.bodies).toHaveLength(1));
    expect(ledger.bodies[0].body).toEqual({
      kind: "income",
      occurredOn: "2026-10-25",
      amount: 3_000_000,
      categoryId: "cat-i1",
      merchant: null,
      paymentMethod: "transfer",
      memo: "10월 월급",
    });
    const row = await within(entriesRegion()).findByRole("button", { name: /10월 월급/ });
    expect(within(row).getByText("+3,000,000원")).toHaveClass("text-money-down");
  });

  it("필수 값이 없거나 범위를 벗어나면 저장하지 않는다", async () => {
    const ledger = mockLedger();
    const { user } = renderLedger();
    await user.click(await screen.findByRole("button", { name: "내역 추가" }));
    const dialog = await screen.findByRole("dialog", { name: "내역 추가" });
    fireEvent.change(within(dialog).getByLabelText("날짜"), { target: { value: "1999-12-31" } });
    await user.type(within(dialog).getByLabelText("사용처"), "가".repeat(101));
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    expect(await within(dialog).findByText("금액을 입력해 주세요.")).toBeInTheDocument();
    expect(within(dialog).getByText("카테고리를 선택해 주세요.")).toBeInTheDocument();
    expect(within(dialog).getByText("날짜를 확인해 주세요.")).toBeInTheDocument();
    expect(within(dialog).getByText("사용처는 100자 이내로 입력해 주세요.")).toBeInTheDocument();
    // 숫자가 아닌 글자는 금액에 들어가지 않는다.
    await user.type(within(dialog).getByLabelText("금액"), "abc0");
    expect(within(dialog).getByLabelText("금액")).toHaveValue("0");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    expect(await within(dialog).findByText("금액은 1원부터 1조원까지 입력할 수 있어요.")).toBeInTheDocument();
    expect(ledger.bodies).toHaveLength(0);
  });

  it("서버 검증 에러는 해당 필드 아래에 보여 준다", async () => {
    mockLedger();
    server.use(
      http.post(apiUrl("/api/ledger/entries"), () =>
        errorResponse(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", [
          { field: "categoryId", message: "카테고리를 확인해 주세요." },
        ]),
      ),
    );
    const { user } = renderLedger();
    await user.click(await screen.findByRole("button", { name: "내역 추가" }));
    const dialog = await screen.findByRole("dialog", { name: "내역 추가" });
    await user.type(within(dialog).getByLabelText("금액"), "5000");
    await chooseOption(dialog, "카테고리", "교통", user);
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    expect(await within(dialog).findByText("카테고리를 확인해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "내역 추가" })).toBeInTheDocument();
  });

  it("내역을 눌러 수정하면 PATCH하고 목록을 갱신한다", async () => {
    const ledger = mockLedger(OCTOBER_SEED);
    const { user } = renderLedger();
    await user.click(await within(await screen.findByRole("region", { name: "내역" })).findByRole("button", { name: /마트/ }));
    const dialog = await screen.findByRole("dialog", { name: "내역 수정" });
    expect(within(dialog).getByLabelText("금액")).toHaveValue("520,000");
    expect(within(dialog).getByLabelText("날짜")).toHaveValue("2026-10-15");
    expect(within(dialog).getByRole("combobox", { name: "카테고리" })).toHaveTextContent("식비");
    expect(within(dialog).getByLabelText("사용처")).toHaveValue("마트");

    const amount = within(dialog).getByLabelText("금액");
    await user.clear(amount);
    await user.type(amount, "600000");
    await chooseOption(dialog, "카테고리", "카페·간식", user);
    await user.clear(within(dialog).getByLabelText("사용처"));
    await user.type(within(dialog).getByLabelText("메모"), "장보기");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(ledger.bodies.at(-1)).toEqual({
      method: "PATCH",
      path: "/api/ledger/entries/entry-5",
      body: {
        kind: "expense",
        occurredOn: "2026-10-15",
        amount: 600000,
        categoryId: "cat-e2",
        merchant: null,
        paymentMethod: "card",
        memo: "장보기",
      },
    });
    const row = await within(entriesRegion()).findByRole("button", { name: /장보기/ });
    expect(within(row).getByText("-600,000원")).toBeInTheDocument();
    expect(within(row).getByText("카페·간식")).toBeInTheDocument();
  });

  it("삭제를 확인하면 DELETE하고 목록에서 뺀다", async () => {
    const ledger = mockLedger(OCTOBER_SEED);
    const { user } = renderLedger();
    await user.click(await within(await screen.findByRole("region", { name: "내역" })).findByRole("button", { name: /쿠팡/ }));
    const dialog = await screen.findByRole("dialog", { name: "내역 수정" });
    await user.click(within(dialog).getByRole("button", { name: "삭제" }));
    const confirm = await screen.findByRole("alertdialog", { name: "내역을 삭제할까요?" });
    await user.click(within(confirm).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(ledger.requests).toContain("DELETE /api/ledger/entries/entry-6");
    await waitFor(() =>
      expect(within(entriesRegion()).queryByRole("button", { name: /쿠팡/ })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(expenseCardValue()).toBe("1,420,000원"));
  });

  it("삭제가 실패하면 다이얼로그에 이유를 보여 준다", async () => {
    mockLedger(OCTOBER_SEED);
    server.use(
      http.delete(apiUrl("/api/ledger/entries/:id"), () => errorResponse(404, "NOT_FOUND", "내역을 찾을 수 없습니다.")),
    );
    const { user } = renderLedger();
    await user.click(await within(await screen.findByRole("region", { name: "내역" })).findByRole("button", { name: /쿠팡/ }));
    const dialog = await screen.findByRole("dialog", { name: "내역 수정" });
    await user.click(within(dialog).getByRole("button", { name: "삭제" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "삭제" }));
    expect(await within(dialog).findByText("내역을 찾을 수 없습니다.")).toBeInTheDocument();
  });

  it("목록을 못 불러오면 다시 시도할 수 있다", async () => {
    mockLedger(OCTOBER_SEED);
    let fail = true;
    server.use(
      // 첫 요청만 실패하고 그다음은 가짜 서버(mockLedger)로 넘긴다.
      http.get(apiUrl("/api/ledger/entries"), () => {
        if (!fail) return undefined;
        fail = false;
        return errorResponse(500, "INTERNAL_ERROR", "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }),
    );
    const { user } = renderLedger();
    const region = await screen.findByRole("region", { name: "내역" });
    expect(await within(region).findByText("서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "다시 시도" }));
    expect(await within(region).findByRole("button", { name: /관리사무소/ })).toBeInTheDocument();
  });
});
