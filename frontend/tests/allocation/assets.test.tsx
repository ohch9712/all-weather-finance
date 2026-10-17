import { screen, waitFor, within } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { AssetsManager } from "@/features/allocation/components/AssetsManager";
import { allocationKeys } from "@/features/allocation/hooks";
import { apiUrl, createTestQueryClient, errorResponse, renderWithProviders, server } from "../utils";
import { REPORT_READY, holding, installFakeAllocationApi } from "./fake-api";
import { RECOMMENDATION_APPLIED } from "./responses";

function seededClient() {
  // 리포트·추천 쿼리가 캐시에 있다가 자산을 바꾸면 무효화되는지 본다.
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(allocationKeys.report, REPORT_READY);
  queryClient.setQueryData(allocationKeys.recommendation, RECOMMENDATION_APPLIED);
  return queryClient;
}

function expectInvalidated(queryClient: ReturnType<typeof createTestQueryClient>) {
  expect(queryClient.getQueryState(allocationKeys.report)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(allocationKeys.recommendation)?.isInvalidated).toBe(true);
}

describe("보유 자산(9.3)", () => {
  it("자산군별로 묶어 합계·비중, 제외·증권사 연동 배지를 보여 준다", async () => {
    installFakeAllocationApi({
      holdings: [
        holding({ id: "h1", name: "국내주식", assetClass: "stock", amount: 26_000_000 }),
        holding({ id: "h2", name: "예금", assetClass: "cash", amount: 20_000_000, memo: "파킹통장" }),
        holding({ id: "h3", name: "증권 계좌 채권", assetClass: "bond", amount: 6_000_000, source: "kiwoom" }),
        holding({ id: "h4", name: "실거주 주택", assetClass: "other", amount: 300_000_000, includeInAllocation: false }),
      ],
    });
    renderWithProviders(<AssetsManager />, { route: "/allocation/assets" });

    expect(await screen.findByRole("button", { name: "국내주식 수정" })).toBeInTheDocument();
    expect(screen.getByText(/배분 대상 합계/)).toHaveTextContent("배분 대상 합계 5,200만원 · 점수 계산에서 뺀 자산 3억원");
    const groups = screen.getAllByRole("heading", { level: 2 }).map((item) => item.textContent);
    expect(groups).toEqual([
      "빠른 추가",
      "주식2,600만원 · 50.0%",
      "채권600만원 · 11.5%",
      "현금성 자산2,000만원 · 38.5%",
      "기타0원 · 0.0%",
    ]);
    expect(screen.getByText("26,000,000원")).toBeInTheDocument();
    expect(screen.getByText("파킹통장")).toBeInTheDocument();
    expect(screen.getByText("점수 계산 제외")).toBeInTheDocument();
    expect(screen.getByText("증권사 연동")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("투자 권유가 아닙니다");
    expect(screen.queryByRole("link", { name: /다음/ })).not.toBeInTheDocument();
  });

  it("자산 추가: 다이얼로그 검증 후 POST, 목록·리포트·추천 갱신", async () => {
    const api = installFakeAllocationApi();
    const queryClient = seededClient();
    const { user } = renderWithProviders(<AssetsManager />, { route: "/allocation/assets", queryClient });
    expect(await screen.findByText("아직 입력한 자산이 없어요")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "자산 추가" }));
    const dialog = await screen.findByRole("dialog", { name: "자산 추가" });
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    expect(await within(dialog).findByText("이름은 1~50자로 입력해 주세요.")).toBeInTheDocument();
    expect(within(dialog).getByText("자산군을 골라 주세요.")).toBeInTheDocument();
    expect(within(dialog).getByText("금액을 입력해 주세요.")).toBeInTheDocument();
    expect(api.writes()).toEqual([]);

    await user.type(within(dialog).getByLabelText("이름"), "  비상금 통장 ");
    await user.click(within(dialog).getByRole("combobox", { name: "자산군" }));
    await user.click(await screen.findByRole("option", { name: "현금성 자산" }));
    await user.type(within(dialog).getByLabelText("금액"), "5000000");
    expect(within(dialog).getByLabelText("금액")).toHaveValue("5,000,000");
    expect(within(dialog).getByText("= 500만원")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      {
        method: "POST",
        path: "/api/allocation/holdings",
        body: { name: "비상금 통장", assetClass: "cash", amount: 5_000_000, includeInAllocation: true, memo: null },
      },
    ]);
    expect(await screen.findByText("비상금 통장")).toBeInTheDocument();
    expectInvalidated(queryClient);
  });

  it("빠른 추가: 실거주 주택은 점수 계산 제외로 채워 둔다", async () => {
    const api = installFakeAllocationApi();
    const { user } = renderWithProviders(<AssetsManager />, { route: "/allocation/assets" });
    await user.click(await screen.findByRole("button", { name: "실거주 주택" }));
    const dialog = await screen.findByRole("dialog", { name: "자산 추가" });
    expect(within(dialog).getByLabelText("이름")).toHaveValue("실거주 주택");
    expect(within(dialog).getByRole("switch", { name: "점수 계산에 포함" })).not.toBeChecked();
    await user.type(within(dialog).getByLabelText("금액"), "300000000");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({
      name: "실거주 주택",
      assetClass: "other",
      amount: 300_000_000,
      includeInAllocation: false,
      memo: null,
    });
  });

  it("서버 검증 에러는 필드 아래에 보여 준다", async () => {
    installFakeAllocationApi();
    server.use(
      http.post(apiUrl("/api/allocation/holdings"), () =>
        errorResponse(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", [
          { field: "amount", message: "허용 범위를 벗어났습니다." },
        ]),
      ),
    );
    const { user } = renderWithProviders(<AssetsManager />, { route: "/allocation/assets" });
    await user.click(await screen.findByRole("button", { name: "국내주식" }));
    const dialog = await screen.findByRole("dialog", { name: "자산 추가" });
    await user.type(within(dialog).getByLabelText("금액"), "1000");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    expect(await within(dialog).findByText("허용 범위를 벗어났습니다.")).toBeInTheDocument();
  });

  it("수정: 기존 값으로 열고 PATCH, 삭제: 확인 후 DELETE", async () => {
    const api = installFakeAllocationApi({
      holdings: [holding({ id: "h1", name: "국내주식", assetClass: "stock", amount: 26_000_000 })],
    });
    const queryClient = seededClient();
    const { user } = renderWithProviders(<AssetsManager />, { route: "/allocation/assets", queryClient });

    await user.click(await screen.findByRole("button", { name: "국내주식 수정" }));
    const dialog = await screen.findByRole("dialog", { name: "자산 수정" });
    const amount = within(dialog).getByLabelText("금액");
    expect(amount).toHaveValue("26,000,000");
    await user.clear(amount);
    await user.type(amount, "30000000");
    await user.type(within(dialog).getByLabelText("메모"), "연금계좌 포함");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      {
        method: "PATCH",
        path: "/api/allocation/holdings/h1",
        body: { name: "국내주식", assetClass: "stock", amount: 30_000_000, includeInAllocation: true, memo: "연금계좌 포함" },
      },
    ]);
    expect(await screen.findByText("30,000,000원")).toBeInTheDocument();
    expectInvalidated(queryClient);

    queryClient.setQueryData(allocationKeys.report, REPORT_READY);
    await user.click(screen.getByRole("button", { name: "국내주식 삭제" }));
    const confirm = await screen.findByRole("alertdialog", { name: "자산을 삭제할까요?" });
    await user.click(within(confirm).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(api.writes().at(-1)).toMatchObject({ method: "DELETE", path: "/api/allocation/holdings/h1" }));
    expect(await screen.findByText("아직 입력한 자산이 없어요")).toBeInTheDocument();
    expect(queryClient.getQueryState(allocationKeys.report)?.isInvalidated).toBe(true);
  });
});

describe("온보딩 간단 입력(9.3)", () => {
  it("0원 줄은 빼고 줄 이름으로 일괄 생성한 뒤 추천 결과로 간다", async () => {
    const api = installFakeAllocationApi();
    const { user, router } = renderWithProviders(<AssetsManager />, { route: "/allocation/assets?onboarding=1" });

    expect(await screen.findByRole("heading", { name: "간단 입력" })).toBeInTheDocument();
    expect(screen.getByText("자산 입력", { selector: "p" })).toHaveTextContent("3/3 자산 입력");
    expect(screen.queryByRole("button", { name: "자산 추가" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("예금·현금"), "20000000");
    await user.type(screen.getByLabelText("주식·주식형 펀드"), "30000000");
    await user.type(screen.getByLabelText("금"), "0");
    await user.type(screen.getByLabelText(/실거주 주택/), "300000000");
    await user.click(screen.getByRole("button", { name: "저장하고 추천 보기" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/allocation/recommendation?onboarding=1"));
    expect(api.writes()).toEqual([
      {
        method: "POST",
        path: "/api/allocation/holdings/bulk",
        body: {
          items: [
            { name: "예금·현금", assetClass: "cash", amount: 20_000_000, includeInAllocation: true, memo: null },
            { name: "주식·주식형 펀드", assetClass: "stock", amount: 30_000_000, includeInAllocation: true, memo: null },
            { name: "실거주 주택", assetClass: "other", amount: 300_000_000, includeInAllocation: false, memo: null },
          ],
        },
      },
    ]);
  });

  it("모두 비우고 저장하거나 건너뛰면 저장 없이 추천 결과로 간다", async () => {
    const api = installFakeAllocationApi();
    const { user, router } = renderWithProviders(<AssetsManager />, { route: "/allocation/assets?onboarding=1" });
    await user.click(await screen.findByRole("button", { name: "저장하고 추천 보기" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/allocation/recommendation?onboarding=1"));
    expect(screen.getByRole("link", { name: "건너뛰기" })).toHaveAttribute("href", "/allocation/recommendation?onboarding=1");
    expect(api.writes()).toEqual([]);
  });

  it("이미 자산이 있으면 목록과 다음 버튼을 보여 준다", async () => {
    installFakeAllocationApi({ holdings: [holding({ id: "h1", name: "예금", assetClass: "cash", amount: 1_000_000 })] });
    renderWithProviders(<AssetsManager />, { route: "/allocation/assets?onboarding=1" });
    expect(await screen.findByText("예금")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "간단 입력" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "다음" })).toHaveAttribute("href", "/allocation/recommendation?onboarding=1");
  });
});
