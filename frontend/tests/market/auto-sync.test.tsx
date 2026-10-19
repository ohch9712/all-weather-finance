import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { BrokerConnectionsSection } from "@/features/market/components/BrokerConnectionsSection";
import type { Connection } from "@/features/market/types";
import { apiUrl, authPayload, errorResponse, renderWithProviders, server } from "../utils";

const connection: Connection = {
  id: "48ff6f66-e047-4dc3-a696-d9baaa433708", provider: "kiwoom", environment: "mock", label: "키움 연결",
  appKeyMasked: "****1234", accountNoMasked: "****5678", status: "unverified",
  autoSync: false, lastAutoSyncAt: null, lastAutoSyncStatus: null, lastAutoSyncErrorCode: null,
  lastVerifiedAt: null, lastErrorCode: null, createdAt: "2026-10-19T03:00:00Z",
};

beforeEach(() => {
  server.use(
    http.get(apiUrl("/api/market/connections"), () => HttpResponse.json({ items: [connection] })),
    http.get(apiUrl("/api/market/snapshot/status"), () => HttpResponse.json({ asOf: null, count: 0, source: "mock" })),
  );
});

function show(items: Connection[]) {
  server.use(http.get(apiUrl("/api/market/connections"), () => HttpResponse.json({ items })));
  return renderWithProviders(<BrokerConnectionsSection />, { auth: authPayload() });
}

describe("자동 동기화", () => {
  it("키움·토스 카드에만 스위치와 일정·토스 안내를 보여 준다", async () => {
    show([connection, { ...connection, id: "toss", provider: "toss", label: "토스 연결" }, { ...connection, id: "mock", provider: "mock", label: "샘플 연결" }]);
    expect(await screen.findAllByRole("switch", { name: "자동 동기화" })).toHaveLength(2);
    expect(screen.getAllByText("평일 오후 8시 30분에 잔고를 자산 현황에, 최근 7일 체결을 매매일지에 반영합니다. 저장된 키로 서버가 조회하며, 끄면 바로 멈춥니다.")).toHaveLength(2);
    expect(screen.getAllByText("같은 토스 키를 다른 프로그램에서도 쓰면, 자동 동기화가 토큰을 새로 받을 때 그 프로그램의 연결이 끊길 수 있습니다.")).toHaveLength(1);
    expect(screen.queryByText(/마지막 자동 동기화/)).not.toBeInTheDocument();
  });

  it("켜고 끌 때 정확한 본문을 보내고 목록을 다시 읽는다", async () => {
    let row = { ...connection };
    const bodies: unknown[] = [];
    let reads = 0;
    server.use(
      http.get(apiUrl("/api/market/connections"), () => { reads += 1; return HttpResponse.json({ items: [row] }); }),
      http.patch(apiUrl(`/api/market/connections/${connection.id}`), async ({ request }) => {
        const body = await request.json() as { autoSync: boolean };
        bodies.push(body);
        row = { ...row, autoSync: body.autoSync };
        return HttpResponse.json(row);
      }),
    );
    const { user } = renderWithProviders(<BrokerConnectionsSection />, { auth: authPayload() });
    const toggle = await screen.findByRole("switch", { name: "자동 동기화" });
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(bodies).toEqual([{ autoSync: true }, { autoSync: false }]);
    expect(reads).toBe(3);
  });

  it.each([false, true])("요청 중에는 비활성이고 실패하면 서버 값 %s와 카드 오류를 유지한다", async (enabled) => {
    let release!: () => void;
    const responded = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.patch(apiUrl(`/api/market/connections/${connection.id}`), async () => {
      await responded;
      return errorResponse(502, "BROKER_IP_NOT_ALLOWED", "허용 IP를 확인하세요.");
    }));
    const { user } = show([{ ...connection, autoSync: enabled }]);
    const toggle = await screen.findByRole("switch", { name: "자동 동기화" });
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(toggle).toHaveAttribute("aria-checked", String(enabled));
    release();
    expect(await screen.findByText("증권사 포털에 이 서버의 IP를 허용 IP로 등록해 주세요.")).toBeInTheDocument();
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute("aria-checked", String(enabled));
  });

  it.each([ ["ok", "성공"], ["partial", "일부 실패"], ["failed", "실패"] ] as const)("마지막 결과 %s를 KST로 보여 준다", async (status, label) => {
    show([{ ...connection, lastAutoSyncAt: "2026-10-19T11:30:00Z", lastAutoSyncStatus: status, lastAutoSyncErrorCode: status === "ok" ? null : "BROKER_AUTH_FAILED" }]);
    expect(await screen.findByText(`마지막 자동 동기화 10월 19일 20:30 · ${label}`)).toBeInTheDocument();
    if (status === "ok") expect(screen.queryByText("앱키·시크릿과 계좌 식별값을 확인해 주세요.")).not.toBeInTheDocument();
    else expect(screen.getByText("앱키·시크릿과 계좌 식별값을 확인해 주세요.")).toBeInTheDocument();
  });
});
