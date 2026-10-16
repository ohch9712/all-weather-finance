import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EXAMPLE_QUESTIONS } from "@/features/chat/components/ChatThread";
import { ChatWidget } from "@/features/chat/components/ChatWidget";
import { openChatWidget } from "@/features/chat";
import { renderWithProviders } from "../utils";
import { CONVERSATION_ID, conversation, displayMessages, mockChatApi } from "./fake-chat";

function renderWidget(route = "/ledger") {
  return renderWithProviders(<ChatWidget />, { route });
}

describe("챗봇 위젯", () => {
  it("버튼으로 열고 닫는다. 최근 대화를 잇는다", async () => {
    const api = mockChatApi({
      conversations: [conversation()],
      details: { [CONVERSATION_ID]: { conversation: conversation(), messages: displayMessages() } },
    });
    const { user } = renderWidget();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "AI 상담 열기" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("AI 상담")).toBeInTheDocument();
    expect(await within(dialog).findByText("지난 질문")).toBeInTheDocument();
    expect(api.calls.detail).toContain(CONVERSATION_ID);
    expect(within(dialog).getByRole("link", { name: "전체 화면으로" })).toHaveAttribute(
      "href",
      `/chat?c=${CONVERSATION_ID}`,
    );
    await user.click(within(dialog).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("/chat에서는 숨긴다", () => {
    mockChatApi();
    renderWidget("/chat");
    expect(screen.queryByRole("button", { name: "AI 상담 열기" })).not.toBeInTheDocument();
  });

  it("최근 대화를 이어 갈 수 없으면 새 대화를 연다", async () => {
    const old = conversation({ canContinue: false });
    const api = mockChatApi({
      conversations: [old],
      details: { [CONVERSATION_ID]: { conversation: old, messages: displayMessages() } },
    });
    const { user } = renderWidget();
    await user.click(screen.getByRole("button", { name: "AI 상담 열기" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: EXAMPLE_QUESTIONS[0] })).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "질문 입력" })).toBeInTheDocument();
    expect(within(dialog).queryByText("지난 질문")).not.toBeInTheDocument();
    expect(api.calls.detail).toEqual([]);
    expect(within(dialog).getByRole("link", { name: "전체 화면으로" })).toHaveAttribute("href", "/chat");
  });

  it("대화가 없으면 새 대화를 연다", async () => {
    mockChatApi();
    const { user } = renderWidget();
    await user.click(screen.getByRole("button", { name: "AI 상담 열기" }));
    expect(await screen.findByRole("button", { name: EXAMPLE_QUESTIONS[1] })).toBeInTheDocument();
  });

  it("openChatWidget({ draft })로 열면 입력창에 문장을 채우고 보내지는 않는다", async () => {
    const api = mockChatApi();
    renderWidget("/");
    act(() => openChatWidget({ draft: "이번 달 지출을 줄이려면?" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("textbox", { name: "질문 입력" })).toHaveValue("이번 달 지출을 줄이려면?");
    expect(api.calls.sent).toEqual([]);
  });
});
