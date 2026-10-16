import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SituationManager } from "@/features/allocation/components/SituationManager";
import { addDays, addYears, todayKst } from "@/features/allocation/dates";
import { allocationKeys } from "@/features/allocation/hooks";
import type { Situation } from "@/features/allocation/types";
import { createTestQueryClient, renderWithProviders } from "../utils";
import { REPORT_READY, goal, installFakeAllocationApi } from "./fake-api";

const SAVED: Situation = {
  monthlyExpense: 2_000_000,
  dependents: 0,
  consumerDebt: 0,
  emergencyMonths: 3,
  emergencyTarget: 6_000_000,
  updatedAt: "2026-10-16T03:00:00Z",
};

describe("목표·상황(9.4)", () => {
  it("저장한 상황의 비상금 목표를 보여 주고, 저장하면 PUT 후 추천 결과로 간다", async () => {
    const api = installFakeAllocationApi({ situation: SAVED });
    const { user, router } = renderWithProviders(<SituationManager />, { route: "/allocation/situation" });

    expect(await screen.findByText("비상금 목표: 600만원(3개월)")).toBeInTheDocument();
    expect(screen.getByLabelText("월 생활비")).toHaveValue("2,000,000");
    expect(screen.getByText("신용대출·카드론·현금서비스 등. 주택담보대출은 넣지 않아요.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "건너뛰기" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "부양가족 수" }));
    await user.click(await screen.findByRole("option", { name: "1명" }));
    await user.type(screen.getByLabelText("고금리 대출 잔액"), "5000000");
    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/allocation/recommendation"));
    expect(api.writes()).toEqual([
      {
        method: "PUT",
        path: "/api/allocation/situation",
        body: { monthlyExpense: 2_000_000, dependents: 1, consumerDebt: 5_000_000 },
      },
    ]);
  });

  it("생활비 검증", async () => {
    const api = installFakeAllocationApi();
    const { user } = renderWithProviders(<SituationManager />, { route: "/allocation/situation" });
    await user.click(await screen.findByRole("button", { name: "저장" }));
    expect(await screen.findByText("월 생활비를 입력해 주세요.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("월 생활비"), "100000001");
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("1억 원 이하로 입력해 주세요.")).toBeInTheDocument();
    expect(api.writes()).toEqual([]);
  });

  it("목표 추가: 종류 칩·이름(비우면 종류 이름)·금액·목표일, 저장 후 목록과 리포트·추천 갱신", async () => {
    const api = installFakeAllocationApi();
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(allocationKeys.report, REPORT_READY);
    const { user } = renderWithProviders(<SituationManager />, { route: "/allocation/situation", queryClient });

    expect(await screen.findByText(/아직 목표가 없어요/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "목표 추가" }));
    const dialog = await screen.findByRole("dialog", { name: "목표 추가" });
    expect(within(dialog).getAllByRole("radio").map((item) => item.closest("label")?.textContent)).toEqual([
      "노후 준비",
      "내 집 마련",
      "자녀 교육",
      "결혼 자금",
      "차량 구입",
      "목돈 마련",
      "기타 목표",
    ]);
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    expect(await within(dialog).findByText("목표 종류를 골라 주세요.")).toBeInTheDocument();
    expect(within(dialog).getByText("1원 이상 1조 원 이하로 입력해 주세요.")).toBeInTheDocument();
    expect(within(dialog).getByText("목표일은 내일부터 50년 안으로 골라 주세요.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: "결혼 자금" }));
    expect(within(dialog).getByLabelText("이름")).toHaveAttribute("placeholder", "결혼 자금");
    await user.type(within(dialog).getByLabelText("목표 금액"), "10000000");
    const date = within(dialog).getByLabelText("목표일");
    const today = todayKst();
    expect(date).toHaveAttribute("min", addDays(today, 1));
    expect(date).toHaveAttribute("max", addYears(today, 50));
    fireEvent.change(date, { target: { value: today } });
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    expect(await within(dialog).findByText("목표일은 내일부터 50년 안으로 골라 주세요.")).toBeInTheDocument();

    const target = addYears(today, 1);
    fireEvent.change(date, { target: { value: target } });
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      {
        method: "POST",
        path: "/api/allocation/goals",
        body: { goalType: "marriage", title: "", targetAmount: 10_000_000, targetDate: target },
      },
    ]);
    expect(await screen.findByRole("list", { name: "목표 목록" })).toBeInTheDocument();
    expect(queryClient.getQueryState(allocationKeys.report)?.isInvalidated).toBe(true);
  });

  it("목표 카드: 구분 배지, 수정(PATCH)·삭제(DELETE)", async () => {
    const api = installFakeAllocationApi({
      goals: [
        goal({ id: "g1", goalType: "car", title: "첫 차", targetAmount: 30_000_000, targetDate: "2027-05-01", horizon: "within_1y" }),
        goal({ id: "g2" }),
        goal({ id: "g3", goalType: "retirement", title: "노후 준비", targetDate: "2056-10-16", horizon: "long_term" }),
      ],
    });
    const { user } = renderWithProviders(<SituationManager />, { route: "/allocation/situation" });
    const list = await screen.findByRole("list", { name: "목표 목록" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards.map((card) => within(card).getByText(/1년 안|3년 안|장기/).textContent)).toEqual(["1년 안", "3년 안", "장기"]);
    expect(cards[0]).toHaveTextContent("차량 구입");
    expect(cards[0]).toHaveTextContent("첫 차");
    expect(cards[0]).toHaveTextContent("3,000만원");
    expect(cards[0]).toHaveTextContent("2027.05.01");

    await user.click(within(cards[0]).getByRole("button", { name: "첫 차 수정" }));
    const dialog = await screen.findByRole("dialog", { name: "목표 수정" });
    expect(within(dialog).getByRole("radio", { name: "차량 구입" })).toBeChecked();
    expect(within(dialog).getByLabelText("이름")).toHaveValue("첫 차");
    expect(within(dialog).getByLabelText("목표 금액")).toHaveValue("30,000,000");
    await user.clear(within(dialog).getByLabelText("이름"));
    await user.type(within(dialog).getByLabelText("이름"), "새 차");
    const nextYear = addYears(todayKst(), 1);
    fireEvent.change(within(dialog).getByLabelText("목표일"), { target: { value: nextYear } });
    await user.click(within(dialog).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      {
        method: "PATCH",
        path: "/api/allocation/goals/g1",
        body: { goalType: "car", title: "새 차", targetAmount: 30_000_000, targetDate: nextYear },
      },
    ]);

    // 이름이 종류 이름 그대로면 비운 채로 연다
    await user.click(screen.getByRole("button", { name: "내 집 마련 수정" }));
    const second = await screen.findByRole("dialog", { name: "목표 수정" });
    expect(within(second).getByLabelText("이름")).toHaveValue("");
    await user.click(within(second).getByRole("button", { name: "취소" }));

    await user.click(screen.getByRole("button", { name: "노후 준비 삭제" }));
    const confirm = await screen.findByRole("alertdialog", { name: "목표를 삭제할까요?" });
    await user.click(within(confirm).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(api.writes().at(-1)).toMatchObject({ method: "DELETE", path: "/api/allocation/goals/g3" }));
    await waitFor(() => expect(screen.queryByText("노후 준비", { selector: "p" })).not.toBeInTheDocument());
  });

  it("목표가 10개면 추가 버튼을 끈다", async () => {
    installFakeAllocationApi({
      goals: Array.from({ length: 10 }, (_, index) => goal({ id: `g${index}`, title: `목표 ${index}` })),
    });
    renderWithProviders(<SituationManager />, { route: "/allocation/situation" });
    expect(await screen.findByText("목표 9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "목표 추가" })).toBeDisabled();
    expect(screen.getByText(/목표는 10개까지 만들 수 있어요\./)).toBeInTheDocument();
  });
});

describe("온보딩 목표·상황(9.4)", () => {
  it("다음: 입력한 상황을 저장하고 간단 입력으로 간다", async () => {
    const api = installFakeAllocationApi();
    const { user, router } = renderWithProviders(<SituationManager />, { route: "/allocation/situation?onboarding=1" });
    expect(await screen.findByText("목표·상황", { selector: "p" })).toHaveTextContent("2/3 목표·상황");
    await user.type(await screen.findByLabelText("월 생활비"), "2000000");
    await user.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/allocation/assets?onboarding=1"));
    expect(api.writes()).toEqual([
      { method: "PUT", path: "/api/allocation/situation", body: { monthlyExpense: 2_000_000, dependents: 0, consumerDebt: 0 } },
    ]);
  });

  it("생활비를 비우고 다음을 누르거나 건너뛰기를 누르면 저장하지 않는다", async () => {
    const api = installFakeAllocationApi();
    const { user, router } = renderWithProviders(<SituationManager />, { route: "/allocation/situation?onboarding=1" });
    expect(await screen.findByRole("link", { name: "건너뛰기" })).toHaveAttribute("href", "/allocation/assets?onboarding=1");
    await user.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/allocation/assets?onboarding=1"));
    expect(api.writes()).toEqual([]);
  });
});
