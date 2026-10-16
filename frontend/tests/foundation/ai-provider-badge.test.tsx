import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { AiProviderBadge } from "@/components/common/AiProviderBadge";
import type { AiStatus } from "@/lib/ai-status";
import { apiUrl, errorResponse, renderWithProviders, server } from "../utils";

const status: AiStatus = {
  general: { enabled: true, provider: "gemini", location: "cloud", model: "gemini-3.8-flash", reason: null },
  personal: { enabled: true, provider: "ollama", location: "local", model: "gemma4:12b", reason: null },
};

function mockStatus(value: AiStatus) {
  server.use(http.get(apiUrl("/api/ai/status"), () => HttpResponse.json(value)));
}

describe("AiProviderBadge", () => {
  it("로컬(Ollama)이면 '로컬 AI'와 외부로 보내지 않는다는 툴팁을 보여 준다", async () => {
    mockStatus(status);
    const { user } = renderWithProviders(<AiProviderBadge scope="personal" />);
    const badge = await screen.findByText("로컬 AI");
    await user.hover(badge);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "입력한 내용은 이 서버의 로컬 AI(Ollama)가 처리하고 외부로 보내지 않아요.",
    );
  });

  it("Gemini면 'Google Gemini'와 전송된다는 툴팁을 보여 준다", async () => {
    mockStatus(status);
    const { user } = renderWithProviders(<AiProviderBadge scope="general" />);
    const badge = await screen.findByText("Google Gemini");
    await user.hover(badge);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("입력한 내용이 Google Gemini API로 전송돼요.");
  });

  it.each([
    ["not_configured", { enabled: false, provider: null, location: null, model: null, reason: "not_configured" }],
    ["billing_required", { enabled: false, provider: "gemini", location: "cloud", model: "gemini-3.8-flash", reason: "billing_required" }],
  ] as const)("꺼져 있으면(%s) 'AI 꺼짐'과 설정 안내 툴팁을 보여 준다", async (_reason, personal) => {
    mockStatus({ ...status, personal });
    const { user } = renderWithProviders(<AiProviderBadge scope="personal" />);
    const badge = await screen.findByText("AI 꺼짐");
    await user.hover(badge);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("서버에 AI 설정이 없어 AI 기능을 쓸 수 없어요.");
  });

  it("compact도 같은 문구를 보여 준다", async () => {
    mockStatus(status);
    renderWithProviders(<AiProviderBadge scope="personal" compact />);
    expect(await screen.findByText("로컬 AI")).toBeInTheDocument();
  });

  it.each([
    ["500", () => errorResponse(500, "INTERNAL_ERROR", "서버 오류가 발생했습니다.")],
    ["401", () => errorResponse(401, "UNAUTHENTICATED", "로그인이 필요합니다.")],
    ["네트워크 오류", () => HttpResponse.error()],
  ])("상태 요청이 실패하면(%s) 아무것도 그리지 않는다", async (_label, respond) => {
    let requested = false;
    server.use(
      http.get(apiUrl("/api/ai/status"), () => {
        requested = true;
        return respond();
      }),
    );
    const { container, queryClient } = renderWithProviders(<AiProviderBadge scope="personal" />);
    await waitFor(() => expect(requested).toBe(true));
    await waitFor(() => expect(queryClient.getQueryState(["ai", "status"])?.status).toBe("error"));
    expect(container).toBeEmptyDOMElement();
  });
});
