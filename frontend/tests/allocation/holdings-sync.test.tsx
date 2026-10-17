import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { AssetsManager } from "@/features/allocation/components/AssetsManager";
import { classificationReason } from "@/features/allocation/classify";
import { allocationKeys } from "@/features/allocation/hooks";
import { apiUrl, createTestQueryClient, errorResponse, renderWithProviders, server } from "../utils";
import { holding, installFakeAllocationApi, REPORT_READY } from "./fake-api";

const CONNECTIONS = [
  { id: "active", provider: "mock", status: "active", label: "내 샘플 계좌" },
  { id: "inactive", provider: "kiwoom", status: "unverified", label: "미확인 계좌" },
];

function connections(items = CONNECTIONS) {
  server.use(http.get(apiUrl("/api/market/connections"), () => HttpResponse.json({ items })));
}

function syncedHolding() {
  return holding({ id: "synced", name: "KODEX CD금리액티브", assetClass: "cash", amount: 2_000_000_000_000, connectionId: "active", source: "mock", syncedAt: "2026-10-17T01:00:00Z" });
}

describe("증권사 잔고 동기화", () => {
  it("활성 연결만 선택하고 결과와 건너뜀을 표시하며 배분 데이터를 갱신한다", async () => {
    const api = installFakeAllocationApi();
    connections();
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(allocationKeys.report, REPORT_READY);
    let body: unknown;
    server.use(http.post(apiUrl("/api/allocation/holdings/sync"), async ({ request }) => {
      body = await request.json();
      api.state.holdings = [syncedHolding()];
      return HttpResponse.json({ created: 1, updated: 2, removed: 3, skipped: [{ name: "Apple", reason: "원화 평가금액이 없어 건너뛰었습니다." }], syncedAt: "2026-10-17T01:00:00Z" });
    }));
    const { user } = renderWithProviders(<AssetsManager />, { route: "/allocation/assets", queryClient });
    await user.click(screen.getByRole("button", { name: "증권사 잔고 불러오기" }));
    const dialog = screen.getByRole("dialog");
    const select = await within(dialog).findByRole("combobox", { name: "증권사 연결" });
    expect(within(dialog).queryByRole("option", { name: /미확인 계좌/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "불러오기" })).toBeDisabled();
    await user.selectOptions(select, "active");
    expect(within(dialog).getByText(/샘플 데이터입니다/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "불러오기" }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent("추가 1개 · 갱신 2개 · 삭제 3개 · 건너뜀 1개");
    expect(within(dialog).getByText(/Apple: 원화 평가금액/)).toBeInTheDocument();
    expect(body).toEqual({ connectionId: "active" });
    expect(queryClient.getQueryState(allocationKeys.report)?.isInvalidated).toBe(true);
    await user.click(within(dialog).getAllByRole("button", { name: "닫기" })[0]);
    expect(await screen.findByText("KODEX CD금리액티브")).toBeInTheDocument();
    expect(screen.getByText("샘플")).toBeInTheDocument();
    expect(screen.getByText(/마지막 동기화/)).toBeInTheDocument();
    expect(screen.getByText(/샘플 데이터입니다/)).toBeInTheDocument();
    expect(screen.getByText(/투자 권유가 아닙니다/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /다시 동기화/ }));
    expect(await screen.findByRole("combobox", { name: "증권사 연결" })).toHaveValue("active");
  });

  it("연결이 없으면 설정 링크와 비활성 실행 버튼을 보여 준다", async () => {
    installFakeAllocationApi();
    connections([]);
    const { user } = renderWithProviders(<AssetsManager />, { route: "/allocation/assets" });
    await user.click(screen.getByRole("button", { name: "증권사 잔고 불러오기" }));
    expect(await screen.findByRole("link", { name: "설정에서 연결하기" })).toHaveAttribute("href", "/settings/connections");
    expect(screen.getByRole("button", { name: "불러오기" })).toBeDisabled();
  });

  it("공급자 오류를 표시하고 같은 연결로 재시도할 수 있다", async () => {
    installFakeAllocationApi();
    connections();
    server.use(http.post(apiUrl("/api/allocation/holdings/sync"), () => errorResponse(501, "BROKER_NOT_SUPPORTED", "이 연결에서는 잔고를 지원하지 않습니다.")));
    const { user } = renderWithProviders(<AssetsManager />, { route: "/allocation/assets" });
    await user.click(screen.getByRole("button", { name: "증권사 잔고 불러오기" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "증권사 연결" }), "active");
    await user.click(screen.getByRole("button", { name: "불러오기" }));
    expect(await screen.findByText("이 연결에서는 잔고를 지원하지 않습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "불러오기" })).toBeEnabled();
  });

  it("금액과 이름은 잠그고 분류·포함 여부·메모만 전송한다", async () => {
    const api = installFakeAllocationApi({ holdings: [syncedHolding()] });
    connections();
    const { user } = renderWithProviders(<AssetsManager />, { route: "/allocation/assets" });
    await user.click(await screen.findByRole("button", { name: "KODEX CD금리액티브 수정" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "이름" })).toBeDisabled();
    expect(within(dialog).getByRole("textbox", { name: "금액" })).toBeDisabled();
    await user.click(within(dialog).getByRole("combobox", { name: "자산군" }));
    await user.click(await screen.findByRole("option", { name: "채권" }));
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()[0].body).toEqual({ assetClass: "bond", includeInAllocation: true, memo: null });
  });

  it("직접 지정·자동 분류 근거·다음 동기화 재생성 안내를 보여 준다", async () => {
    installFakeAllocationApi({ holdings: [{ ...syncedHolding(), classOverride: true }] });
    connections();
    const { user } = renderWithProviders(<AssetsManager />, { route: "/allocation/assets" });
    expect(await screen.findByText("직접 지정")).toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: "자동 분류 근거" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("CD금리");
    await user.click(screen.getByRole("button", { name: "KODEX CD금리액티브 삭제" }));
    expect(await screen.findByText(/다음 동기화에서 다시 생길 수 있어요/)).toBeInTheDocument();
  });

  it("분류 표시 근거는 규칙 순서와 기본값을 따른다", () => {
    expect(classificationReason("sofr bond gold")).toContain("SOFR");
    expect(classificationReason("예수금(내 계좌)")).toContain("현금성");
    expect(classificationReason("금융 은행")).toContain("키워드가 없어 주식");
  });
});
