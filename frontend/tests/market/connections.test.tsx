import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { BrokerConnectionsSection } from "@/features/market/components/BrokerConnectionsSection";
import type { Connection } from "@/features/market/types";
import { apiUrl, authPayload, errorResponse, renderWithProviders, server } from "../utils";

const initial: Connection = {
  id: "48ff6f66-e047-4dc3-a696-d9baaa433708", provider: "mock", environment: "mock", label: "샘플 계좌",
  appKeyMasked: "****1234", accountNoMasked: "****5678", status: "unverified",
  lastVerifiedAt: null, lastErrorCode: null, createdAt: "2026-10-16T03:00:00Z",
};

beforeEach(() => {
  server.use(
    http.get(apiUrl("/api/market/connections"), () => HttpResponse.json({ items: [] })),
    http.get(apiUrl("/api/market/snapshot/status"), () => HttpResponse.json({ asOf: "2026-10-16", count: 80, source: "mock" })),
    http.get(apiUrl("/api/market/connections/egress-ip"), () => HttpResponse.json({ ip: "203.0.113.7" })),
  );
});

describe("증권사 연결", () => {
  it("연결 추가, 확인, 삭제와 샘플·IP 안내를 보여 준다", async () => {
    let rows: Connection[] = [];
    let submitted: Record<string, unknown> | undefined;
    server.use(
      http.get(apiUrl("/api/market/connections"), () => HttpResponse.json({ items: rows })),
      http.post(apiUrl("/api/market/connections"), async ({ request }) => {
        submitted = await request.json() as Record<string, unknown>;
        rows = [{ ...initial, label: submitted.label as string }];
        return HttpResponse.json(rows[0], { status: 201 });
      }),
      http.post(apiUrl(`/api/market/connections/${initial.id}/verify`), () => {
        rows = [{ ...rows[0], status: "active", lastVerifiedAt: "2026-10-16T04:00:00Z" }];
        return HttpResponse.json(rows[0]);
      }),
      http.delete(apiUrl(`/api/market/connections/${initial.id}`), () => {
        rows = []; return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderWithProviders(<BrokerConnectionsSection allowMock />, { auth: authPayload() });
    expect(await screen.findByText("203.0.113.7")).toBeInTheDocument();
    expect(await screen.findByText("종목 80개")).toBeInTheDocument();
    expect(screen.getByLabelText(/샘플 데이터:/)).toBeInTheDocument();
    expect(screen.getByText("증권사 연동은 조회만 합니다. 주문은 할 수 없습니다.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "연결 추가" }));
    await user.selectOptions(screen.getByLabelText("증권사"), "mock");
    await user.type(screen.getByLabelText("별칭"), "테스트 연결");
    await user.type(screen.getByLabelText("앱키"), "test-key-1234");
    await user.type(screen.getByLabelText("시크릿"), "test-secret");
    await user.type(screen.getByLabelText("계좌번호"), "test-account");
    expect(screen.getByLabelText("시크릿")).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "연결 저장" }));
    expect(await screen.findByText("테스트 연결")).toBeInTheDocument();
    expect(submitted?.provider).toBe("mock");
    expect(screen.queryByDisplayValue("test-secret")).not.toBeInTheDocument();
    expect(screen.getByText("미확인")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "연결 확인" }));
    expect(await screen.findByText("정상")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "삭제" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("증권사 연결을 삭제할까요?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "연결 삭제" }));
    expect(await screen.findByText("아직 연결한 증권사가 없어요")).toBeInTheDocument();
  });

  it("오류 상태와 허용 IP 안내를 보여 준다", async () => {
    server.use(http.get(apiUrl("/api/market/connections"), () => HttpResponse.json({ items: [{ ...initial, status: "error", lastErrorCode: "BROKER_IP_NOT_ALLOWED" }] })));
    renderWithProviders(<BrokerConnectionsSection />, { auth: authPayload() });
    expect(await screen.findByText("오류")).toBeInTheDocument();
    expect(screen.getByText("증권사 포털에 이 서버의 IP를 허용 IP로 등록해 주세요.")).toBeInTheDocument();
  });

  it("운영 화면에는 샘플 증권사 선택지를 숨기고 토스는 실전만 허용한다", async () => {
    const { user } = renderWithProviders(<BrokerConnectionsSection allowMock={false} />, { auth: authPayload() });
    await user.click(screen.getByRole("button", { name: "연결 추가" }));
    expect(screen.queryByRole("option", { name: "샘플 증권사" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("증권사"), "toss");
    expect(screen.queryByRole("option", { name: "모의" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("환경")).toHaveValue("real");
    expect(screen.getByLabelText("계좌 식별값 (accountSeq)")).toBeInTheDocument();
  });

  it("IP 조회 실패와 추가 실패를 안내한다", async () => {
    server.use(
      http.get(apiUrl("/api/market/connections/egress-ip"), () => HttpResponse.json({ ip: null })),
      http.post(apiUrl("/api/market/connections"), () => errorResponse(409, "CONFLICT", "이미 사용 중인 연결 별칭입니다.")),
    );
    const { user } = renderWithProviders(<BrokerConnectionsSection allowMock />, { auth: authPayload() });
    expect(await screen.findByText("확인할 수 없음")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "연결 추가" }));
    await user.type(screen.getByLabelText("별칭"), "중복");
    await user.type(screen.getByLabelText("앱키"), "test-key");
    await user.type(screen.getByLabelText("시크릿"), "test-secret");
    await user.click(screen.getByRole("button", { name: "연결 저장" }));
    await waitFor(() => expect(screen.getByText("이미 사용 중인 연결 별칭입니다.")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
