import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuccessionPage } from "@/features/succession/components/SuccessionPage";
import type { SuccessionInput } from "@/features/succession/types";
import { apiUrl, authPayload, errorResponse, renderWithProviders, server } from "../utils";
import { CASE_A, envelope, RESULT, SHORT_RESULT } from "./fixtures";

const LIFE = {
  father: { tableLifeExpectancy: "12.0", healthFactor: "1.0", lifeExpectancy: "12.0", yearsAssumed: 12, source: "국가데이터처 2024년 생명표" },
  mother: { tableLifeExpectancy: "17.5", healthFactor: "1.1", lifeExpectancy: "19.3", yearsAssumed: 19, source: "국가데이터처 2024년 생명표" },
};

interface Calls {
  saves: { case: SuccessionInput; sensitiveConsent: boolean }[];
  plans: SuccessionInput[];
  deletes: string[];
}

function mockApi(initial = envelope(null), result = RESULT): Calls {
  const calls: Calls = { saves: [], plans: [], deletes: [] };
  let current = initial;
  server.use(
    http.get(apiUrl("/api/succession/case"), () => HttpResponse.json(current)),
    http.put(apiUrl("/api/succession/case"), async ({ request }) => {
      const body = (await request.json()) as Calls["saves"][number];
      calls.saves.push(body);
      current = envelope(body.case, body.sensitiveConsent ? "2026-10-21T03:00:00Z" : null);
      return HttpResponse.json(current);
    }),
    http.delete(apiUrl("/api/succession/case"), () => {
      calls.deletes.push("case");
      current = envelope(null);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(apiUrl("/api/succession/case/sensitive"), () => {
      calls.deletes.push("sensitive");
      current = { ...current, sensitiveConsentAt: null };
      return HttpResponse.json(current);
    }),
    http.get(apiUrl("/api/succession/life-expectancy"), ({ request }) => {
      const role = new URL(request.url).searchParams.get("role") as "father" | "mother";
      return HttpResponse.json(LIFE[role]);
    }),
    http.post(apiUrl("/api/succession/plans"), async ({ request }) => {
      calls.plans.push((await request.json()) as SuccessionInput);
      return HttpResponse.json(result);
    }),
  );
  return calls;
}

function render(route = "/succession") {
  return renderWithProviders(<SuccessionPage />, { route, auth: authPayload() });
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("입력", () => {
  it("네 섹션, 세무 고지, 기대여명 표시와 직접 고치기", async () => {
    mockApi();
    const { user } = render();
    expect(await screen.findByRole("region", { name: "1. 부모님" })).toBeVisible();
    for (const name of ["2. 부모님 재산", "3. 나와 형제자매", "4. 가정값"]) expect(screen.getByRole("region", { name })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "상속·증여(과제)" })).toBeVisible();
    expect(screen.getByText("2026.05.10 시행 세법 기준")).toBeVisible();
    expect(screen.getByText(/세금 계산 결과는 입력값과 2026년 10월 기준 세법/)).toBeVisible();
    expect(screen.getByText(/‘검토용 요약’을 출력해 주세요/)).toBeVisible();

    await user.type(screen.getByLabelText(/아버지 나이/), "75");
    expect(await screen.findByText("통계 12.0년 × 건강 1.0 = 12.0년")).toBeVisible();
    const father = screen.getByRole("group", { name: "아버지" });
    await user.click(within(father).getByRole("button", { name: "직접 고치기" }));
    const override = within(father).getByLabelText("직접 고친 기대여명(년)");
    await user.type(override, "10.5");
    expect(override).toHaveValue("10.5");
    await user.click(within(father).getByRole("button", { name: "통계값 쓰기" }));
    expect(within(father).queryByLabelText("직접 고친 기대여명(년)")).not.toBeInTheDocument();

    // 금액 도우미와 서울 선택 시 조정대상지역 기본 체크
    await user.type(screen.getByRole("textbox", { name: "부모님 월 생활비" }), "120000000");
    expect(screen.getByRole("textbox", { name: "부모님 월 생활비" })).toHaveValue("120,000,000");
    expect(screen.getByText("1.2억원 · 12,000만원")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "재산 추가" }));
    const house = screen.getAllByRole("group").find((group) => group.getAttribute("aria-label") === "재산 2")!;
    await user.selectOptions(within(house).getByLabelText("소재 시·도"), "서울");
    expect(within(house).getByLabelText("조정대상지역")).toBeChecked();
    expect(within(house).getByText(/2025-10-16부터 서울 25개 구 전역과 경기 12곳/)).toBeVisible();
    expect(screen.getByText("저장하지 않은 변경이 있어요")).toBeVisible();
  });

  it("재산·자녀·과거 증여를 추가·삭제하고 검증 메시지를 보여 준다", async () => {
    const calls = mockApi();
    const { user } = render();
    const assets = await screen.findByRole("region", { name: "2. 부모님 재산" });
    expect(within(assets).getByRole("button", { name: "삭제 현금·예금" })).toBeDisabled();
    await user.click(within(assets).getByRole("button", { name: "재산 추가" }));
    expect(within(assets).getAllByRole("group")).toHaveLength(2);
    await user.click(within(assets).getByRole("button", { name: "삭제 재산 2" }));
    expect(within(assets).getAllByRole("group")).toHaveLength(1);

    const children = screen.getByRole("region", { name: "3. 나와 형제자매" });
    await user.click(within(children).getByRole("button", { name: "형제자매 추가" }));
    expect(within(children).getByRole("group", { name: "자녀 2" })).toBeVisible();
    const me = within(children).getByRole("group", { name: "나" });
    await user.click(within(me).getByRole("button", { name: "증여 내역 추가" }));
    expect(within(me).getByRole("group", { name: "나 증여 1" })).toBeVisible();
    await user.click(within(me).getByRole("button", { name: "증여 내역 삭제 1" }));
    expect(within(me).queryByRole("group", { name: "나 증여 1" })).not.toBeInTheDocument();
    await user.click(within(children).getByRole("button", { name: "삭제 자녀 2" }));

    await user.click(screen.getByRole("button", { name: "방안 비교하기" }));
    expect(await screen.findAllByText("40~110세로 입력해 주세요.")).toHaveLength(2);
    expect(screen.getByText("금액을 0원~1조 원으로 입력해 주세요.")).toBeVisible();
    expect(screen.getByText("19~90세로 입력해 주세요.")).toBeVisible();

    await user.click(screen.getByRole("switch", { name: "아버지 살아 계세요" }));
    await user.click(screen.getByRole("button", { name: "방안 비교하기" }));
    expect(await screen.findByText("재산 명의자는 살아 계신 부모님이어야 해요.")).toBeVisible();
    expect(calls.plans).toHaveLength(0);
  });

  it("서버 검증 오류를 해당 칸에 보여 준다", async () => {
    mockApi(envelope(CASE_A));
    server.use(
      http.post(apiUrl("/api/succession/plans"), () =>
        errorResponse(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", [{ field: "parentsHouseCount", message: "입력한 주택 수보다 적을 수 없어요." }]),
      ),
    );
    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "방안 비교하기" }));
    expect(await screen.findByText("입력한 주택 수보다 적을 수 없어요.")).toBeVisible();
  });
});

describe("민감정보 동의", () => {
  const AGREE = "[선택] 부모님 건강 상태(민감정보) 저장에 동의해요";
  const INFORMED = "건강 정보의 주인인 부모님께 알리고 동의를 받았어요";

  it("두 체크가 모두 있어야 sensitiveConsent: true로 저장하고, 철회할 수 있다", async () => {
    const calls = mockApi(envelope(CASE_A));
    const { user } = render();
    expect(await screen.findByText(/수집 목적: 부모님 기대여명 추정과 이전 방안 계산/)).toBeVisible();
    expect(screen.getByLabelText(/아버지 나이/)).toHaveValue("75");
    expect(screen.getByLabelText("어머니 건강 상태")).toHaveValue("good");

    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(calls.saves).toHaveLength(1));
    expect(calls.saves[0].sensitiveConsent).toBe(false);
    expect(calls.saves[0].case.parents.map((parent) => parent.health)).toEqual(["normal", "good"]);

    await user.click(screen.getByLabelText(AGREE));
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(calls.saves).toHaveLength(2));
    expect(calls.saves[1].sensitiveConsent).toBe(false);

    await user.click(screen.getByLabelText(AGREE));
    await user.click(screen.getByLabelText(INFORMED));
    expect(screen.getByText("저장하지 않은 변경이 있어요")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(calls.saves).toHaveLength(3));
    expect(calls.saves[2].sensitiveConsent).toBe(true);
    expect(await screen.findByText("동의일 2026.10.21")).toBeVisible();
    expect(screen.queryByText("저장하지 않은 변경이 있어요")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "동의 철회" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/저장한 부모님 건강 상태와 동의 기록을 바로 지워요/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "동의 철회" }));
    await waitFor(() => expect(calls.deletes).toEqual(["sensitive"]));
    await waitFor(() => expect(screen.queryByText("동의일 2026.10.21")).not.toBeInTheDocument());
    expect(screen.getByLabelText(AGREE)).not.toBeChecked();
    expect(screen.getByLabelText(INFORMED)).not.toBeChecked();
  });

  it("저장한 동의가 있으면 두 체크를 켠 채로 불러오고, 입력 지우기는 모두 지운다", async () => {
    const calls = mockApi(envelope(CASE_A, "2026-10-20T03:00:00Z"));
    const { user } = render();
    expect(await screen.findByText("동의일 2026.10.20")).toBeVisible();
    expect(screen.getByLabelText(AGREE)).toBeChecked();
    expect(screen.getByLabelText(INFORMED)).toBeChecked();
    await user.click(screen.getByRole("button", { name: "입력 지우기" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(calls.deletes).toEqual(["case"]));
    await waitFor(() => expect(screen.getByLabelText(/아버지 나이/)).toHaveValue(""));
    expect(screen.getByLabelText(AGREE)).not.toBeChecked();
  });
});

describe("결과", () => {
  it("비교표 3열·좁은 화면 카드·방안 상세·다른 방안·계산하지 않은 방안", async () => {
    const calls = mockApi(envelope(CASE_A));
    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "방안 비교하기" }));
    const table = await screen.findByRole("table", { name: "방안 비교표" });
    expect(calls.plans[0]).toEqual(CASE_A);
    const headers = within(table).getAllByRole("columnheader");
    expect(headers).toHaveLength(4);
    expect(headers.slice(1).map((cell) => cell.textContent)).toEqual([
      "최선안부동산 증여 + 현금 10년 공제 한도 증여",
      "차선안 1부동산을 지금 그대로 증여",
      "차선안 2부동산을 팔아 현금으로 지금 증여",
    ]);
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
      "이전 대상과 자산 종류",
      "이전 금액과 시기",
      "예상 세금",
      "부모님에게 남는 재산(지금)",
      "추천 이유",
    ]);
    expect(within(table).getAllByText("나: 주택(증여)")).toHaveLength(3);
    expect(within(table).getAllByText("2026-10-21 증여 700,000,000원")).toHaveLength(3);
    expect(within(table).getByText("766,564,390원")).toBeVisible();
    expect(within(table).getByText("입력한 조건에서 세금 총액이 가장 적어요(766,564,390원).")).toBeVisible();
    const cards = screen.getByRole("list", { name: "방안 비교 카드" });
    expect(within(cards).getAllByRole("listitem").filter((item) => item.parentElement === cards)).toHaveLength(3);

    const funding = screen.getByRole("region", { name: "이전 가능액" });
    expect(within(funding).getByText("277,335,141원")).toBeVisible();
    expect(within(funding).getByText(/통계 17.5년 × 건강 1.1 → 적용 19.3년/)).toBeVisible();
    expect(screen.queryByText(/생활·간병비가 현금보다/)).not.toBeInTheDocument();

    const detail = screen.getByText(/^1위 부동산 증여 \+ 현금 10년 공제 한도 증여 상세/).closest("details")!;
    expect(detail).not.toHaveAttribute("open");
    await user.click(within(detail).getByText(/상세/));
    expect(detail).toHaveAttribute("open");
    expect(within(detail).getByText("이전 일정")).toBeVisible();
    expect(within(detail).getByText("나: 1채 → 2채")).toBeVisible();
    expect(within(detail).getByText(/이월과세/)).toBeVisible();
    expect(screen.getByText("다른 방안 1개")).toBeVisible();
    expect(screen.getByText("계산하지 않은 방안 1개")).toBeVisible();
    expect(screen.getByText(/— 생활비·간병비를 떼어 두면 지금 넘길 현금이 없어요\./)).toBeVisible();
    expect(screen.getByRole("link", { name: "세무전문가 검토용 요약" })).toHaveAttribute("href", "/succession?view=review");
    expect(screen.getByText("계산 기준과 가정")).toBeVisible();
  });

  it("생활·간병비가 현금보다 많으면 경고한다", async () => {
    mockApi(envelope(CASE_A), SHORT_RESULT);
    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "방안 비교하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "생활·간병비가 현금보다 92,000,000원 많아요. 지금 재산을 넘기기보다 부모님 생활 자금을 먼저 확보해야 해요.",
    );
  });
});

describe("검토용 요약", () => {
  it("결과가 없고 저장한 입력도 없으면 안내와 입력 화면 링크를 보여 준다", async () => {
    mockApi();
    render("/succession?view=review");
    expect(await screen.findByText("먼저 방안을 계산해 주세요.")).toBeVisible();
    expect(screen.getByRole("link", { name: "입력 화면으로" })).toHaveAttribute("href", "/succession");
  });

  it("저장한 입력으로 다시 계산해 요약·확인 요청 항목·메모 칸·인쇄 버튼을 보여 준다", async () => {
    const calls = mockApi(envelope(CASE_A));
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const { user } = render("/succession?view=review");
    expect(await screen.findByRole("heading", { level: 1, name: "세무전문가 검토용 요약" })).toBeVisible();
    expect(calls.plans).toEqual([CASE_A]);
    expect(screen.getByText(/기준일 2026-10-21 · 규칙 버전 KR-2026.05.10/)).toBeVisible();
    for (const name of ["입력 정보", "방안 비교표(전체 순위)", "방안별 상세", "적용 세법 기준과 출처, 계산 가정", "확인 요청 항목", "검토 의견"]) {
      expect(screen.getByRole("region", { name })).toBeVisible();
    }
    expect(screen.getAllByText("보통").length).toBeGreaterThan(0);
    expect(screen.getAllByText("좋음").length).toBeGreaterThan(0);
    const checklist = within(screen.getByRole("region", { name: "확인 요청 항목" })).getAllByRole("listitem");
    expect(checklist).toHaveLength(11);
    expect(checklist[10]).toHaveTextContent("11. 기준일 이후 세법·규제지역 변경 여부");
    expect(screen.getAllByTestId("memo-line")).toHaveLength(5);
    expect(screen.getByRole("table", { name: "방안 비교표(전체 순위)" })).toHaveTextContent("4위증여 없이 모두 상속");
    expect(screen.getAllByText(/세금 계산 결과는 입력값과/).length).toBeGreaterThan(0);
    const printButton = screen.getByRole("button", { name: "인쇄·PDF로 저장" });
    expect(printButton.parentElement).toHaveClass("print:hidden");
    await user.click(printButton);
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "입력 화면으로" })).toHaveAttribute("href", "/succession");
  });
});
