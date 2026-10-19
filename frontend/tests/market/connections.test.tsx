import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { BrokerConnectionsSection } from "@/features/market/components/BrokerConnectionsSection";
import type { Connection, TossAccount } from "@/features/market/types";
import { apiUrl, authPayload, errorResponse, renderWithProviders, server } from "../utils";

type User = ReturnType<typeof renderWithProviders>["user"];

const initial: Connection = {
  id: "48ff6f66-e047-4dc3-a696-d9baaa433708", provider: "mock", environment: "mock", label: "샘플 계좌",
  appKeyMasked: "****1234", accountNoMasked: "****5678", status: "unverified",
  autoSync: false, lastAutoSyncAt: null, lastAutoSyncStatus: null, lastAutoSyncErrorCode: null,
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
    expect(await screen.findByText("종목 80개")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "서버 공인 IP 확인" }));
    expect(await screen.findByText("203.0.113.7")).toBeInTheDocument();
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
    expect(screen.queryByLabelText("계좌 식별값 (accountSeq)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "계좌 불러오기" })).toBeInTheDocument();
  });

  it("IP 조회 실패와 추가 실패를 안내한다", async () => {
    server.use(
      http.get(apiUrl("/api/market/connections/egress-ip"), () => HttpResponse.json({ ip: null })),
      http.post(apiUrl("/api/market/connections"), () => errorResponse(409, "CONFLICT", "이미 사용 중인 연결 별칭입니다.")),
    );
    const { user } = renderWithProviders(<BrokerConnectionsSection allowMock />, { auth: authPayload() });
    await user.click(screen.getByRole("button", { name: "서버 공인 IP 확인" }));
    expect(await screen.findByText("확인할 수 없음")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "연결 추가" }));
    await user.type(screen.getByLabelText("별칭"), "중복");
    await user.type(screen.getByLabelText("앱키"), "test-key");
    await user.type(screen.getByLabelText("시크릿"), "test-secret");
    await user.click(screen.getByRole("button", { name: "연결 저장" }));
    await waitFor(() => expect(screen.getByText("이미 사용 중인 연결 별칭입니다.")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("서버 공인 IP는 화면 진입 시 부르지 않고 버튼을 누를 때 한 번만 부른다", async () => {
    let calls = 0;
    let release!: () => void;
    const responded = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.get(apiUrl("/api/market/connections/egress-ip"), async () => {
      calls += 1;
      await responded;
      return HttpResponse.json({ ip: "203.0.113.7" });
    }));
    const { user } = renderWithProviders(<BrokerConnectionsSection allowMock />, { auth: authPayload() });
    expect(await screen.findByText("종목 80개")).toBeInTheDocument();
    expect(await screen.findByText("아직 연결한 증권사가 없어요")).toBeInTheDocument();
    expect(screen.getByText("버튼을 누르면 확인합니다")).toBeInTheDocument();
    expect(calls).toBe(0);

    const button = screen.getByRole("button", { name: "서버 공인 IP 확인" });
    await user.click(button);
    expect(await screen.findByText("확인 중…")).toBeInTheDocument();
    expect(button).toBeDisabled();
    release();
    expect(await screen.findByText("203.0.113.7")).toBeInTheDocument();
    expect(calls).toBe(1);

    // 받은 결과는 이 화면에 머무는 동안 다시 부르지 않는다.
    expect(button).toBeDisabled();
    await user.click(button);
    expect(calls).toBe(1);
  });

  it("IP 조회 요청이 실패하면 확인할 수 없음을 보여 주고 다시 시도할 수 있다", async () => {
    let calls = 0;
    server.use(http.get(apiUrl("/api/market/connections/egress-ip"), () => {
      calls += 1;
      return calls === 1 ? errorResponse(500, "INTERNAL_ERROR", "서버 오류가 발생했습니다.") : HttpResponse.json({ ip: "203.0.113.7" });
    }));
    const { user } = renderWithProviders(<BrokerConnectionsSection allowMock />, { auth: authPayload() });
    const button = screen.getByRole("button", { name: "서버 공인 IP 확인" });
    await user.click(button);
    expect(await screen.findByText("확인할 수 없음")).toBeInTheDocument();
    expect(button).toBeEnabled();
    await user.click(button);
    expect(await screen.findByText("203.0.113.7")).toBeInTheDocument();
    expect(calls).toBe(2);
  });
});

describe("토스 계좌 불러오기", () => {
  const brokerage: TossAccount = { accountSeq: "1", accountType: "BROKERAGE", accountNoLast4: "8901" };
  const pension: TossAccount = { accountSeq: "2", accountType: "PENSION_SAVINGS", accountNoLast4: "2109" };

  function mockAccounts(response: () => Response) {
    const requests: Record<string, unknown>[] = [];
    server.use(http.post(apiUrl("/api/market/connections/toss-accounts"), async ({ request }) => {
      requests.push(await request.json() as Record<string, unknown>);
      return response();
    }));
    return requests;
  }
  function mockCreate() {
    const submitted: Record<string, unknown>[] = [];
    server.use(http.post(apiUrl("/api/market/connections"), async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      submitted.push(body);
      return HttpResponse.json({ ...initial, provider: "toss", environment: "real", label: body.label as string }, { status: 201 });
    }));
    return submitted;
  }
  async function openTossForm(user: User, keys = true) {
    await user.click(screen.getByRole("button", { name: "연결 추가" }));
    await user.selectOptions(screen.getByLabelText("증권사"), "toss");
    await user.type(screen.getByLabelText("별칭"), "토스 계좌");
    if (keys) {
      await user.type(screen.getByLabelText("앱키"), "test-toss-key");
      await user.type(screen.getByLabelText("시크릿"), "test-toss-secret");
    }
  }
  const loadButton = () => screen.getByRole("button", { name: "계좌 불러오기" });
  const saveButton = () => screen.getByRole("button", { name: "연결 저장" });

  it("키움 폼은 계좌번호 칸을 그대로 두고, 토스는 앱키·시크릿이 있어야 불러오기를 켠다", async () => {
    const { user } = renderWithProviders(<BrokerConnectionsSection />, { auth: authPayload() });
    await user.click(screen.getByRole("button", { name: "연결 추가" }));
    expect(screen.getByLabelText("계좌번호")).toHaveAttribute("type", "password");
    expect(screen.queryByRole("button", { name: "계좌 불러오기" })).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("증권사"), "toss");
    expect(screen.queryByLabelText("계좌번호")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /accountSeq/ })).not.toBeInTheDocument();
    expect(loadButton()).toBeDisabled();
    await user.type(screen.getByLabelText("앱키"), "test-toss-key");
    expect(loadButton()).toBeDisabled();
    await user.type(screen.getByLabelText("시크릿"), "test-toss-secret");
    expect(loadButton()).toBeEnabled();
    expect(saveButton()).toBeDisabled();
  });

  it("계좌가 하나면 자동으로 고르고 저장할 때 accountSeq를 accountNo로 보낸다", async () => {
    const requests = mockAccounts(() => HttpResponse.json({ items: [brokerage] }));
    const submitted = mockCreate();
    const { user } = renderWithProviders(<BrokerConnectionsSection />, { auth: authPayload() });
    await openTossForm(user);
    await user.click(loadButton());
    const select = await screen.findByLabelText("계좌");
    expect(select).toHaveValue("1");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["종합매매 ****8901"]);
    expect(requests).toEqual([{ appKey: "test-toss-key", appSecret: "test-toss-secret" }]);
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({ provider: "toss", environment: "real", label: "토스 계좌", accountNo: "1" });
  });

  it("계좌가 여러 개면 고른 뒤에만 저장할 수 있다", async () => {
    mockAccounts(() => HttpResponse.json({ items: [brokerage, pension] }));
    const submitted = mockCreate();
    const { user } = renderWithProviders(<BrokerConnectionsSection />, { auth: authPayload() });
    await openTossForm(user);
    await user.click(loadButton());
    const select = await screen.findByLabelText("계좌");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["계좌를 고르세요", "종합매매 ****8901", "PENSION_SAVINGS ****2109"]);
    expect(select).toHaveValue("");
    expect(saveButton()).toBeDisabled();
    await user.selectOptions(select, "2");
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].accountNo).toBe("2");
  });

  it("계좌가 없으면 안내하고 저장을 막는다", async () => {
    mockAccounts(() => HttpResponse.json({ items: [] }));
    const { user } = renderWithProviders(<BrokerConnectionsSection />, { auth: authPayload() });
    await openTossForm(user);
    await user.click(loadButton());
    expect(await screen.findByText("토스증권 종합매매 계좌가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByLabelText("계좌")).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it.each([
    ["BROKER_IP_NOT_ALLOWED", "증권사 포털에 이 서버의 IP를 허용 IP로 등록해 주세요."],
    ["BROKER_AUTH_FAILED", "앱키·시크릿과 계좌 식별값을 확인해 주세요."],
  ])("불러오기 오류 %s는 기존 오류 안내를 보여 준다", async (code, message) => {
    mockAccounts(() => errorResponse(502, code, "서버 오류 문구"));
    const { user } = renderWithProviders(<BrokerConnectionsSection />, { auth: authPayload() });
    await openTossForm(user);
    await user.click(loadButton());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByLabelText("계좌")).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(loadButton()).toBeEnabled();
  });

  it("앱키·시크릿이나 증권사를 바꾸면 불러온 목록과 선택을 비운다", async () => {
    const requests = mockAccounts(() => HttpResponse.json({ items: [brokerage] }));
    const { user } = renderWithProviders(<BrokerConnectionsSection />, { auth: authPayload() });
    await openTossForm(user);
    for (const field of ["앱키", "시크릿"]) {
      await user.click(loadButton());
      expect(await screen.findByLabelText("계좌")).toHaveValue("1");
      expect(saveButton()).toBeEnabled();
      await user.type(screen.getByLabelText(field), "-changed");
      expect(screen.queryByLabelText("계좌")).not.toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    }
    expect(requests.at(-1)).toEqual({ appKey: "test-toss-key-changed", appSecret: "test-toss-secret" });

    await user.click(loadButton());
    expect(await screen.findByLabelText("계좌")).toHaveValue("1");
    await user.selectOptions(screen.getByLabelText("증권사"), "kiwoom");
    expect(screen.getByLabelText("계좌번호")).toHaveValue("");
    await user.selectOptions(screen.getByLabelText("증권사"), "toss");
    expect(screen.queryByLabelText("계좌")).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("불러오는 중에 키를 바꾸면 늦게 온 응답으로 목록을 채우지 않는다", async () => {
    let release!: () => void;
    const responded = new Promise<void>((resolve) => { release = resolve; });
    let served = 0;
    server.use(http.post(apiUrl("/api/market/connections/toss-accounts"), async () => {
      await responded;
      served += 1;
      return HttpResponse.json({ items: [brokerage] });
    }));
    const { user } = renderWithProviders(<BrokerConnectionsSection />, { auth: authPayload() });
    await openTossForm(user);
    await user.click(loadButton());
    expect(await screen.findByRole("button", { name: "불러오는 중…" })).toBeDisabled();
    await user.type(screen.getByLabelText("앱키"), "-changed");
    expect(loadButton()).toBeEnabled();
    release();
    await waitFor(() => expect(served).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByLabelText("계좌")).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });
});
