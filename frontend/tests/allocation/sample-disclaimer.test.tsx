import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AllocationReportView } from "@/features/allocation/components/AllocationReportView";
import { RecommendationView } from "@/features/allocation/components/RecommendationView";
import { allocationKeys } from "@/features/allocation/hooks";
import type { Holding } from "@/features/allocation/types";
import { createTestQueryClient, renderWithProviders } from "../utils";
import { holding, installFakeAllocationApi } from "./fake-api";

const SAMPLE_NOTICE = "샘플 데이터입니다. 실제 시세가 아닙니다.";
const manual = holding({ id: "manual", name: "직접 입력 자산", assetClass: "cash", amount: 1_000_000 });
const mock = holding({ id: "mock", name: "샘플 자산", assetClass: "stock", amount: 500_000, source: "mock" });

describe.each([
  { name: "리포트", View: AllocationReportView, route: "/allocation", readyHeading: "배분 점수" },
  { name: "추천 결과", View: RecommendationView, route: "/allocation/recommendation", readyHeading: "먼저 할 일" },
])("$name 샘플 고지", ({ View, route, readyHeading }) => {
  it.each<{ name: string; holdings: Holding[]; visible: boolean }>([
    { name: "직접 입력 자산과 포함된 Mock 자산이 섞이면 표시", holdings: [manual, mock], visible: true },
    { name: "금액이 0이어도 포함된 Mock 행이 있으면 표시", holdings: [{ ...mock, amount: 0 }], visible: true },
    { name: "Mock 행이 배분에서 제외되면 숨김", holdings: [manual, { ...mock, includeInAllocation: false }], visible: false },
    { name: "직접 입력 자산만 있으면 숨김", holdings: [manual], visible: false },
    { name: "키움 자산만 있으면 숨김", holdings: [{ ...manual, source: "kiwoom" }], visible: false },
    { name: "토스 자산만 있으면 숨김", holdings: [{ ...manual, source: "toss" }], visible: false },
    { name: "CODEF 자산만 있으면 숨김", holdings: [{ ...manual, source: "codef" }], visible: false },
    { name: "보유 자산이 없으면 숨김", holdings: [], visible: false },
  ])("$name", async ({ holdings, visible }) => {
    installFakeAllocationApi({ holdings });
    const queryClient = createTestQueryClient();
    renderWithProviders(<View />, { route, queryClient });

    await screen.findByRole("heading", { name: readyHeading });
    await waitFor(() => expect(queryClient.getQueryState(allocationKeys.holdings)?.status).toBe("success"));
    if (visible) {
      expect(await screen.findByText(SAMPLE_NOTICE)).toBeInTheDocument();
    } else {
      expect(screen.queryByText(SAMPLE_NOTICE)).not.toBeInTheDocument();
    }
    expect(screen.getByText(/투자 결정과 그 결과의 책임은 본인에게 있습니다/)).toBeInTheDocument();
  });
});
