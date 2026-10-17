import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LedgerRoute from "@/app/(app)/ledger/page";
import { renderWithProviders } from "../utils";
import { mockLedger } from "./mock-ledger";

async function openManager() {
  const view = renderWithProviders(<LedgerRoute />, { route: "/ledger?month=2026-10" });
  await view.user.click(await screen.findByRole("button", { name: "카테고리 관리" }));
  const dialog = await screen.findByRole("dialog", { name: "카테고리 관리" });
  return { ...view, dialog };
}

function myList(dialog: HTMLElement, kind: "지출" | "수입") {
  return within(dialog).getByRole("region", { name: `내 ${kind} 카테고리` });
}

describe("카테고리 관리", () => {
  it("내 카테고리를 추가하면 목록과 내역 다이얼로그 선택지에 나온다", async () => {
    const ledger = mockLedger();
    const { user, dialog } = await openManager();
    expect(within(myList(dialog, "지출")).getByText("아직 추가한 카테고리가 없어요.")).toBeInTheDocument();
    // 기본 카테고리는 관리 목록에 나오지 않는다.
    expect(within(dialog).queryByText("식비")).not.toBeInTheDocument();

    await user.type(within(dialog).getByRole("textbox", { name: "새 카테고리 이름" }), "  반려동물 ");
    await user.click(within(dialog).getByRole("button", { name: "추가" }));
    expect(await within(myList(dialog, "지출")).findByText("반려동물")).toBeInTheDocument();
    expect(ledger.bodies.at(-1)).toEqual({
      method: "POST",
      path: "/api/ledger/categories",
      body: { kind: "expense", name: "반려동물" },
    });
    expect(within(dialog).getByRole("textbox", { name: "새 카테고리 이름" })).toHaveValue("");

    await user.click(within(dialog).getByRole("combobox", { name: "종류" }));
    await user.click(await screen.findByRole("option", { name: "수입" }));
    await user.type(within(dialog).getByRole("textbox", { name: "새 카테고리 이름" }), "중고 판매");
    await user.click(within(dialog).getByRole("button", { name: "추가" }));
    expect(await within(myList(dialog, "수입")).findByText("중고 판매")).toBeInTheDocument();
    expect(ledger.bodies.at(-1)?.body).toEqual({ kind: "income", name: "중고 판매" });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "내역 추가" }));
    const entryDialog = await screen.findByRole("dialog", { name: "내역 추가" });
    await user.click(within(entryDialog).getByRole("combobox", { name: "카테고리" }));
    expect(await screen.findByRole("option", { name: "반려동물" })).toBeInTheDocument();
  });

  it("이름이 비었거나 이미 있으면 알려 준다", async () => {
    const ledger = mockLedger();
    const { user, dialog } = await openManager();
    await user.click(within(dialog).getByRole("button", { name: "추가" }));
    expect(await within(dialog).findByText("카테고리 이름은 1~20자로 입력해 주세요.")).toBeInTheDocument();
    expect(ledger.bodies).toHaveLength(0);

    await user.type(within(dialog).getByRole("textbox", { name: "새 카테고리 이름" }), "식비");
    await user.click(within(dialog).getByRole("button", { name: "추가" }));
    expect(await within(dialog).findByText("이미 있는 카테고리입니다.")).toBeInTheDocument();
  });

  it("이름을 바꾸면 PATCH한다", async () => {
    const ledger = mockLedger();
    const { user, dialog } = await openManager();
    await user.type(within(dialog).getByRole("textbox", { name: "새 카테고리 이름" }), "반려동물");
    await user.click(within(dialog).getByRole("button", { name: "추가" }));
    await user.click(await within(dialog).findByRole("button", { name: "반려동물 이름 바꾸기" }));

    const input = within(dialog).getByRole("textbox", { name: "반려동물의 새 이름" });
    expect(input).toHaveValue("반려동물");
    await user.clear(input);
    await user.type(input, "반려견");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    expect(await within(myList(dialog, "지출")).findByText("반려견")).toBeInTheDocument();
    expect(ledger.bodies.at(-1)).toEqual({
      method: "PATCH",
      path: "/api/ledger/categories/cat-new-9",
      body: { name: "반려견" },
    });
  });

  it("삭제하면 '내역은 기타로 옮겨집니다'를 확인한 뒤 지우고 내역을 다시 불러온다", async () => {
    const ledger = mockLedger();
    const { user, dialog } = await openManager();
    await user.type(within(dialog).getByRole("textbox", { name: "새 카테고리 이름" }), "반려동물");
    await user.click(within(dialog).getByRole("button", { name: "추가" }));
    const entriesBefore = ledger.requests.filter((request) => request.startsWith("GET /api/ledger/entries")).length;

    await user.click(await within(dialog).findByRole("button", { name: "반려동물 삭제" }));
    const confirm = await screen.findByRole("alertdialog", { name: "카테고리를 삭제할까요?" });
    expect(confirm).toHaveTextContent("내역은 기타로 옮겨집니다");
    expect(confirm).toHaveTextContent("기타 지출");
    await user.click(within(confirm).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(ledger.requests).toContain("DELETE /api/ledger/categories/cat-new-9"));
    expect(await within(myList(dialog, "지출")).findByText("아직 추가한 카테고리가 없어요.")).toBeInTheDocument();
    await waitFor(() =>
      expect(ledger.requests.filter((request) => request.startsWith("GET /api/ledger/entries")).length).toBeGreaterThan(
        entriesBefore,
      ),
    );
  });
});
