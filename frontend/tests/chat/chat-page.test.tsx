import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LOCATION_TEXT } from "@/features/chat/components/Composer";
import {
  EXAMPLE_QUESTIONS,
  LIMIT_TEXT,
  PROVIDER_OFF_TEXT,
  READ_ONLY_TEXT,
} from "@/features/chat/components/ChatThread";
import { ChatPage } from "@/features/chat/components/ChatPage";
import { DISCLAIMER_TEXT } from "@/components/common/Disclaimer";
import { errorResponse, renderWithProviders } from "../utils";
import {
  CONVERSATION_ID,
  chatStatus,
  conversation,
  displayMessages,
  messageEnd,
  messageStart,
  mockChatApi,
  sseStream,
} from "./fake-chat";

function renderPage(route = "/chat") {
  return renderWithProviders(<ChatPage />, { route });
}

describe("/chat 첫 화면", () => {
  it("예시 질문 4개, 처리 위치(로컬), 남은 횟수, AI 고지, 공급자 배지를 보여 준다", async () => {
    mockChatApi();
    renderPage();
    for (const question of EXAMPLE_QUESTIONS) {
      expect(await screen.findByRole("button", { name: question })).toBeInTheDocument();
    }
    expect(screen.getByText(LOCATION_TEXT.local)).toBeInTheDocument();
    expect(screen.getByText("오늘 남은 횟수 97회")).toBeInTheDocument();
    expect(screen.getByText(DISCLAIMER_TEXT.ai)).toBeInTheDocument();
    expect(await screen.findByText("로컬 AI")).toBeInTheDocument();
  });

  it("Gemini면 전송 위치 문구를 바꾼다", async () => {
    mockChatApi({ status: chatStatus({ provider: "gemini", location: "cloud", model: "gemini-3.8-flash" }), location: "cloud" });
    renderPage();
    expect(await screen.findByText(LOCATION_TEXT.cloud)).toBeInTheDocument();
    expect(screen.queryByText(LOCATION_TEXT.local)).not.toBeInTheDocument();
  });

  it("공급자가 꺼져 있으면 입력창 대신 안내를 보여 준다", async () => {
    mockChatApi({ status: chatStatus({ enabled: false, provider: null, location: null, model: null }), location: null });
    renderPage();
    expect(await screen.findByText(PROVIDER_OFF_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "질문 입력" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EXAMPLE_QUESTIONS[0] })).not.toBeInTheDocument();
  });

  it("하루 상한을 다 쓰면 안내하고 보내지 않는다", async () => {
    mockChatApi({ status: chatStatus({ usedToday: 100 }) });
    renderPage();
    expect(await screen.findByText(LIMIT_TEXT)).toBeInTheDocument();
    expect(screen.getByText("오늘 남은 횟수 0회")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "질문 입력" })).toBeDisabled();
  });
});

describe("메시지 주고받기", () => {
  it("첫 질문에서 대화를 만들고 받은 글자를 이어 붙인다", async () => {
    const stream = sseStream();
    const api = mockChatApi({ onSend: () => stream.response() });
    const { user } = renderPage();
    const input = await screen.findByRole("textbox", { name: "질문 입력" });
    await user.type(input, "내 나이대 알려줘{Enter}");
    await waitFor(() => expect(api.calls.sent).toEqual([{ id: CONVERSATION_ID, content: "내 나이대 알려줘" }]));
    expect(api.calls.created).toBe(1);
    expect(input).toHaveValue("");
    expect(screen.getByText("내 나이대 알려줘", { selector: "p" })).toBeInTheDocument();
    stream.event("message_start", messageStart);
    expect(await screen.findByText("답을 만드는 중")).toBeInTheDocument();
    stream.event("text_delta", { text: "현재 " });
    stream.event("text_delta", { text: "30대예요." });
    expect(await screen.findByText("현재 30대예요.")).toBeInTheDocument();
    expect(screen.queryByText("답을 만드는 중")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "멈추기" })).toBeInTheDocument();
    stream.event("message_end", messageEnd);
    stream.close();
    expect(await screen.findByRole("button", { name: "보내기" })).toBeInTheDocument();
    expect(screen.getByText("현재 30대예요.")).toBeInTheDocument();
    // 새 대화는 URL에 남긴다.
    expect(window.location.search).toBe(`?c=${CONVERSATION_ID}`);
  });

  it("도구 칩이 진행 중 → 성공·실패로 바뀌고 카드를 그린다", async () => {
    const stream = sseStream();
    mockChatApi({ onSend: () => stream.response() });
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: EXAMPLE_QUESTIONS[0] }));
    stream.event("message_start", messageStart);
    stream.event("tool_start", { toolUseId: "call_0_0", name: "get_my_profile", label: "프로필 확인 중" });
    const chips = await screen.findByRole("list", { name: "도구 실행 상태" });
    const chip = within(chips).getByText("프로필 확인 중").closest("li");
    expect(chip).toHaveAttribute("data-status", "running");
    expect(within(chip as HTMLElement).getByText("(진행 중)")).toBeInTheDocument();
    stream.event("tool_end", {
      toolUseId: "call_0_0",
      name: "get_my_profile",
      ok: true,
      card: { type: "key_value", title: "내 프로필", items: [{ label: "나이대", value: "30대" }] },
    });
    await waitFor(() => expect(chip).toHaveAttribute("data-status", "ok"));
    expect(await screen.findByText("내 프로필")).toBeInTheDocument();
    expect(screen.getByText("30대")).toBeInTheDocument();
    // 다음 라운드 글자를 기다리는 동안
    expect(screen.getByText("답을 만드는 중")).toBeInTheDocument();
    stream.event("tool_start", { toolUseId: "call_1_0", name: "get_today", label: "오늘 날짜 확인 중" });
    stream.event("tool_end", { toolUseId: "call_1_0", name: "get_today", ok: false, card: null });
    const failed = (await screen.findByText("오늘 날짜 확인 중")).closest("li");
    await waitFor(() => expect(failed).toHaveAttribute("data-status", "error"));
    stream.event("text_delta", { text: "30대에 맞는 배분이에요." });
    stream.event("message_end", messageEnd);
    stream.close();
    expect(await screen.findByText("30대에 맞는 배분이에요.")).toBeInTheDocument();
  });

  it("멈추기를 누르면 받기를 그만두고 다시 보낼 수 있다", async () => {
    const stream = sseStream();
    mockChatApi({ onSend: () => stream.response() });
    const { user } = renderPage();
    await user.type(await screen.findByRole("textbox", { name: "질문 입력" }), "긴 질문{Enter}");
    stream.event("message_start", messageStart);
    stream.event("text_delta", { text: "쓰는 중" });
    expect(await screen.findByText("쓰는 중")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "멈추기" }));
    expect(await screen.findByText("답변을 멈췄어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보내기" })).toBeInTheDocument();
    expect(screen.getByText("쓰는 중")).toBeInTheDocument();
  });

  it("에러 이벤트 문구를 보여 준다", async () => {
    const stream = sseStream();
    mockChatApi({ onSend: () => stream.response() });
    const { user } = renderPage();
    await user.type(await screen.findByRole("textbox", { name: "질문 입력" }), "질문{Enter}");
    stream.event("message_start", messageStart);
    stream.event("error", { code: "LLM_REFUSED", message: "이 질문에는 답할 수 없어요. 다른 방식으로 물어봐 주세요." });
    stream.close();
    expect(await screen.findByText("이 질문에는 답할 수 없어요. 다른 방식으로 물어봐 주세요.")).toBeInTheDocument();
  });

  it("상한 429는 안내로 바꾸고 입력을 돌려준다", async () => {
    mockChatApi({
      onSend: () => errorResponse(429, "CHAT_LIMIT_EXCEEDED", "오늘 대화 한도를 다 썼어요. 내일 다시 이용해 주세요."),
    });
    const { user } = renderPage();
    const input = await screen.findByRole("textbox", { name: "질문 입력" });
    await user.type(input, "질문{Enter}");
    expect(await screen.findByText(LIMIT_TEXT)).toBeInTheDocument();
    expect(input).toHaveValue("질문");
  });

  it("Shift+Enter는 줄을 바꾸고 보내지 않는다", async () => {
    const api = mockChatApi();
    const { user } = renderPage();
    const input = await screen.findByRole("textbox", { name: "질문 입력" });
    await user.type(input, "첫 줄{Shift>}{Enter}{/Shift}둘째 줄");
    expect(input).toHaveValue("첫 줄\n둘째 줄");
    expect(api.calls.sent).toEqual([]);
  });
});

describe("저장된 대화", () => {
  it("?c=로 연 대화의 기록(Markdown·도구 칩·카드)을 보여 준다", async () => {
    mockChatApi({
      conversations: [conversation()],
      details: { [CONVERSATION_ID]: { conversation: conversation(), messages: displayMessages() } },
    });
    renderPage(`/chat?c=${CONVERSATION_ID}`);
    expect(await screen.findByText("지난 질문")).toBeInTheDocument();
    expect(screen.getByText("답변", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByText("프로필 확인 중")[0].closest("li")).toHaveAttribute("data-status", "ok");
    expect(screen.getByText("내 프로필")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EXAMPLE_QUESTIONS[0] })).not.toBeInTheDocument();
  });

  it("이어 갈 수 없는 대화는 읽기 전용 안내와 새 대화 버튼을 보여 준다", async () => {
    const old = conversation({ canContinue: false, provider: "gemini", model: "gemini-3.8-flash" });
    mockChatApi({
      conversations: [old],
      details: { [CONVERSATION_ID]: { conversation: old, messages: displayMessages() } },
    });
    const { user } = renderPage(`/chat?c=${CONVERSATION_ID}`);
    expect(await screen.findByText(READ_ONLY_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "질문 입력" })).not.toBeInTheDocument();
    // 목록에는 "이전 AI 설정" 배지
    const list = await screen.findByRole("list", { name: "대화 목록" });
    expect(within(list).getByText("이전 AI 설정")).toBeInTheDocument();
    const note = screen.getByText(READ_ONLY_TEXT).closest("[role=note]") as HTMLElement;
    await user.click(within(note).getByRole("button", { name: "새 대화" }));
    expect(await screen.findByRole("textbox", { name: "질문 입력" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: EXAMPLE_QUESTIONS[0] })).toBeInTheDocument();
  });

  it("목록에서 대화를 고르고 확인 후 삭제한다", async () => {
    const api = mockChatApi({
      conversations: [conversation()],
      details: { [CONVERSATION_ID]: { conversation: conversation(), messages: displayMessages() } },
    });
    const { user } = renderPage();
    const list = await screen.findByRole("list", { name: "대화 목록" });
    await user.click(within(list).getByText("내 나이대 알려줘").closest("button") as HTMLElement);
    expect(await screen.findByText("지난 질문")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "내 나이대 알려줘 삭제" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(api.calls.deleted).toEqual([CONVERSATION_ID]));
    // 보고 있던 대화를 지우면 새 대화로 돌아간다.
    expect(await screen.findByRole("button", { name: EXAMPLE_QUESTIONS[0] })).toBeInTheDocument();
    expect(await screen.findByText("아직 대화가 없어요.")).toBeInTheDocument();
  });
});

describe("AI 고지", () => {
  // 저장된 AI 답변이 보이면 입력 가능 여부와 상관없이 고지가 붙어야 한다(AGENTS.md 보안·고지).
  function aiNotices() {
    return document.querySelectorAll('[data-variant="ai"]');
  }

  it("읽기 전용 대화의 기존 응답에도 고지를 붙인다", async () => {
    const old = conversation({ canContinue: false, provider: "gemini", model: "gemini-3.8-flash" });
    mockChatApi({
      conversations: [old],
      details: { [CONVERSATION_ID]: { conversation: old, messages: displayMessages() } },
    });
    renderPage(`/chat?c=${CONVERSATION_ID}`);
    expect(await screen.findByText(READ_ONLY_TEXT)).toBeInTheDocument();
    expect(screen.getByText("답변", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "질문 입력" })).not.toBeInTheDocument();
    expect(aiNotices()).toHaveLength(1);
    expect(aiNotices()[0]).toHaveTextContent(DISCLAIMER_TEXT.ai);
  });

  it("공급자가 꺼진 상태의 기존 응답에도 고지를 붙인다", async () => {
    const old = conversation({ canContinue: false });
    mockChatApi({
      status: chatStatus({ enabled: false, provider: null, location: null, model: null }),
      location: null,
      conversations: [old],
      details: { [CONVERSATION_ID]: { conversation: old, messages: displayMessages() } },
    });
    renderPage(`/chat?c=${CONVERSATION_ID}`);
    expect(await screen.findByText(PROVIDER_OFF_TEXT)).toBeInTheDocument();
    expect(screen.getByText("답변", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "질문 입력" })).not.toBeInTheDocument();
    expect(aiNotices()).toHaveLength(1);
    expect(aiNotices()[0]).toHaveTextContent(DISCLAIMER_TEXT.ai);
  });

  it("입력할 수 있는 대화에도 고지를 하나 붙인다", async () => {
    mockChatApi({
      conversations: [conversation()],
      details: { [CONVERSATION_ID]: { conversation: conversation(), messages: displayMessages() } },
    });
    renderPage(`/chat?c=${CONVERSATION_ID}`);
    expect(await screen.findByRole("textbox", { name: "질문 입력" })).toBeInTheDocument();
    expect(screen.getByText("답변", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(LOCATION_TEXT.local)).toBeInTheDocument();
    expect(aiNotices()).toHaveLength(1);
    expect(aiNotices()[0]).toHaveTextContent(DISCLAIMER_TEXT.ai);
  });
});
