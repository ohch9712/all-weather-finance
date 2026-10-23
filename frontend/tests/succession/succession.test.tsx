import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuccessionPage } from "@/features/succession/components/SuccessionPage";
import type { SuccessionInput } from "@/features/succession/types";
import { formatKRWCompact } from "@/lib/format";
import { apiUrl, authPayload, errorResponse, renderWithProviders, server } from "../utils";
import { CASE_A, CASE_D, COVERED_RESULT, envelope, RESULT, RESULT_D, SHORT_RESULT } from "./fixtures";

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
    // 도우미는 짧은 표기만 보이고 " · 만원" 둘째 표기는 없다(18절)
    expect(screen.getByText("1.2억원")).toBeVisible();
    expect(screen.queryByText(/ · [\d,.]+만원/)).not.toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "부모님 월 생활비" }));
    await user.type(screen.getByRole("textbox", { name: "부모님 월 생활비" }), "2500000");
    expect(screen.getByText("250만원")).toBeVisible();
    expect(screen.queryByText(/ · [\d,.]+만원/)).not.toBeInTheDocument();
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

  it("가정값에 한 분만 계실 때 생활비·수입 비율 두 칸과 근거 안내가 있고, 검증과 기본값 되돌리기를 한다", async () => {
    const calls = mockApi();
    const { user } = render();
    const section = await screen.findByRole("region", { name: "4. 가정값" });
    const living = within(section).getByLabelText("한 분만 계실 때 생활비 비율(%)");
    const income = within(section).getByLabelText("한 분만 계실 때 수입 비율(%)");
    expect(living).toHaveValue("61");
    expect(income).toHaveValue("60");
    expect(within(section).getByLabelText("생활비·수입·간병비 연 상승률(%)")).toHaveValue("2");
    expect(within(section).getByText(/두 분 중 한 분만 계시게 된 해부터 월 생활비에 곱해요\. 앱 가정값\(2026년 기준 중위소득 1인 가구 2,564,238원 ÷ 2인 가구 4,199,292원 ≈ 61%\)/)).toBeVisible();
    expect(
      within(section).getByText(/월 수입에 곱해요\. 앱 가정값\(국민연금 유족연금은 가입기간에 따라 기본연금액의 40~60%, 본인 연금과 겹치면 본인 연금 \+ 유족연금 30%\)/),
    ).toBeVisible();

    await user.clear(living);
    await user.type(living, "9.5");
    await user.clear(income);
    await user.type(income, "100.5");
    await user.click(screen.getByRole("button", { name: "방안 비교하기" }));
    expect(await within(section).findByText("10~100%로 입력해 주세요.")).toBeVisible();
    expect(within(section).getByText("0~100%로 입력해 주세요.")).toBeVisible();
    expect(calls.plans).toHaveLength(0);

    await user.click(within(section).getByRole("button", { name: "기본값으로 되돌리기" }));
    expect(living).toHaveValue("61");
    expect(income).toHaveValue("60");
    await waitFor(() => expect(within(section).queryByText("10~100%로 입력해 주세요.")).not.toBeInTheDocument());
    expect(within(section).queryByText("0~100%로 입력해 주세요.")).not.toBeInTheDocument();
  });

  it("저장한 두 비율을 불러와 그대로 계산 요청에 보낸다", async () => {
    const calls = mockApi(envelope(CASE_D), RESULT_D);
    const { user } = render();
    const section = await screen.findByRole("region", { name: "4. 가정값" });
    await waitFor(() => expect(screen.getByLabelText(/아버지 나이/)).toHaveValue("75"));
    const living = within(section).getByLabelText("한 분만 계실 때 생활비 비율(%)");
    expect(living).toHaveValue("61");
    await user.clear(living);
    await user.type(living, "70.5");
    await user.click(screen.getByRole("button", { name: "방안 비교하기" }));
    await waitFor(() => expect(calls.plans).toHaveLength(1));
    expect(calls.plans[0].assumptions).toEqual({ ...CASE_D.assumptions, survivorLivingRatio: "70.5" });
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
      "차선안 2이전 가능액을 지금 현금으로 증여",
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
    // 예상 세금 두 줄(19절): 굵게 상속 시점 기준, 그 아래 작게 낸 금액 합계, 이어서 항목별 세금.
    const taxCells = within(table).getByRole("rowheader", { name: "예상 세금" }).parentElement!.querySelectorAll("td");
    expect([...taxCells[0].querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "상속 시점 기준 907,861,575원",
      "낸 금액 합계 766,564,390원",
      "증여세 232,800,000원",
      "취득세 113,175,161원",
      "양도세 0원",
      "상속세 420,589,229원",
    ]);
    expect(within(taxCells[0]).getByText("상속 시점 기준 907,861,575원")).toHaveClass("font-semibold");
    expect(within(taxCells[0]).getByText("낸 금액 합계 766,564,390원")).toHaveClass("text-xs");
    expect(within(taxCells[2]).getByText("상속 시점 기준 947,407,960원")).toBeVisible();
    expect(within(taxCells[2]).getByText("낸 금액 합계 936,413,428원")).toBeVisible();
    expect(within(table).getByText("상속 시점(2038-10-21) 기준으로 맞춘 세금 합계가 가장 적어요(907,861,575원).")).toBeVisible();
    expect(within(table).getByText("상속 시점 기준 세금 합계가 최선안보다 16,260,854원 많아요.")).toBeVisible();
    expect(within(table).getByText("상속 시점 기준 세금 합계가 최선안보다 39,546,385원 많아요.")).toBeVisible();
    const cards = screen.getByRole("list", { name: "방안 비교 카드" });
    const cardItems = within(cards).getAllByRole("listitem").filter((item) => item.parentElement === cards);
    expect(cardItems).toHaveLength(3);
    expect(within(cardItems[0]).getByText("상속 시점 기준 907,861,575원")).toHaveClass("font-semibold");
    expect(within(cardItems[0]).getByText("낸 금액 합계 766,564,390원")).toBeVisible();
    expect(within(cardItems[2]).getByText("이전 가능액을 지금 현금으로 증여")).toBeVisible();

    const compare = screen.getByRole("region", { name: "방안 비교(상속 시점 기준 세금이 적은 순)" });
    expect(within(compare).getByRole("heading", { level: 2 })).toHaveTextContent("방안 비교(상속 시점 기준 세금이 적은 순)");
    expect(
      within(compare).getByText(
        "생활·간병비를 먼저 떼어 둔 뒤, 지금 내는 세금을 상속 시점(2038-10-21)까지 연 3%로 불려 상속세와 더한 금액이 가장 적은 방안을 최선안으로 골랐어요.",
      ),
    ).toBeVisible();
    // 차트: 합계 막대는 상속 시점 기준, 범례 "세금 합계(상속 시점 기준)", 항목 막대는 낸 금액 그대로.
    expect(within(compare).getByRole("img", { name: "방안별 상속 시점 기준 세금 합계와 항목" })).toBeInTheDocument();
    expect(within(compare).getByText("세금 합계(상속 시점 기준)", { selector: "li span" })).toBeInTheDocument();
    const chartTable = within(compare).getByRole("table", { name: "방안별 상속 시점 기준 세금 합계와 항목" });
    expect(within(chartTable).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "항목",
      "세금 합계(상속 시점 기준)",
      "증여세",
      "취득세",
      "양도세",
      "상속세",
    ]);
    expect(within(chartTable).getAllByRole("row")[1].textContent).toBe(
      ["1위 부동산+공제 분산", ...[907_861_575, 232_800_000, 113_175_161, 0, 420_589_229].map(formatKRWCompact)].join(""),
    );

    const funding = screen.getByRole("region", { name: "이전 가능액" });
    expect(within(funding).getByText("277,335,141원")).toBeVisible();
    expect(within(funding).getByText(/통계 17.5년 × 건강 1.1 → 적용 19.3년/)).toBeVisible();
    expect(screen.queryByText(/생활·간병비가 현금보다/)).not.toBeInTheDocument();

    const detail = screen.getByText("1위 부동산 증여 + 현금 10년 공제 한도 증여 상세 · 상속 시점 기준 세금 907,861,575원").closest("details")!;
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

  it("연도별 생활비·간병비 표는 생활비·수입·간병비·필요 금액을 보여 준다", async () => {
    mockApi(envelope(CASE_A));
    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "방안 비교하기" }));
    const funding = await screen.findByRole("region", { name: "이전 가능액" });
    const costs = within(funding).getByText("연도별 생활비·간병비 보기").closest("details")!;
    expect(costs).not.toHaveAttribute("open");
    await user.click(within(costs).getByText("연도별 생활비·간병비 보기"));
    const table = within(costs).getByRole("table", { name: "연도별 생활비·간병비" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "연차",
      "날짜",
      "생활비",
      "수입",
      "간병비",
      "필요 금액",
    ]);
    const [, first, tenth] = within(table).getAllByRole("row");
    expect(within(first).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "0년차",
      "2026-10-21",
      "36,000,000원",
      "12,000,000원",
      "0원",
      "24,000,000원",
    ]);
    expect(within(tenth).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "10년차",
      "2036-10-21",
      "43,883,799원",
      "14,627,933원",
      "29,255,866원",
      "58,511,732원",
    ]);
    // 좁은 화면 카드도 같은 6개 항목이다.
    const cards = within(costs).getByRole("list", { name: "연도별 생활비·간병비" });
    const firstCard = within(cards).getAllByRole("listitem")[0];
    expect([...firstCard.querySelectorAll("dt")].map((term) => term.textContent)).toEqual([
      "연차",
      "날짜",
      "생활비",
      "수입",
      "간병비",
      "필요 금액",
    ]);
    expect(within(costs).queryByText(/따로 떼어 둘 생활·간병비가 없어요/)).not.toBeInTheDocument();
  });

  it("모든 해의 필요 금액이 0이면 안내 문구를 표 위에 보여 준다", async () => {
    mockApi(envelope(CASE_A), COVERED_RESULT);
    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "방안 비교하기" }));
    const funding = await screen.findByRole("region", { name: "이전 가능액" });
    const costs = within(funding).getByText("연도별 생활비·간병비 보기").closest("details")!;
    await user.click(within(costs).getByText("연도별 생활비·간병비 보기"));
    const notice = within(costs).getByText("월 수입이 생활비와 간병비보다 많아 따로 떼어 둘 생활·간병비가 없어요.");
    expect(notice).toBeVisible();
    const table = within(costs).getByRole("table", { name: "연도별 생활비·간병비" });
    expect(notice.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(table).getAllByRole("columnheader")).toHaveLength(6);
  });

  it("생활·간병비가 현금보다 많으면 경고한다", async () => {
    mockApi(envelope(CASE_A), SHORT_RESULT);
    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "방안 비교하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "생활·간병비가 현금보다 92,000,000원 많아요. 지금 재산을 넘기기보다 부모님 생활 자금을 먼저 확보해야 해요.",
    );
    // singleFrom이 없으면 한 분만 계신 뒤 안내가 없다(21절).
    expect(screen.queryByText(/한 분만 계신다고 보고/)).not.toBeInTheDocument();
  });

  it("한 분만 계신 날부터의 비율 안내를 연도별 표 위에, 가정값·가구·간병 줄을 계산 기준과 가정에 보여 준다", async () => {
    const calls = mockApi(envelope(CASE_D), RESULT_D);
    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "방안 비교하기" }));
    const funding = await screen.findByRole("region", { name: "이전 가능액" });
    expect(calls.plans[0]).toEqual(CASE_D);
    expect(within(funding).getByText("461,576,150원")).toBeVisible();
    const costs = within(funding).getByText("연도별 생활비·간병비 보기").closest("details")!;
    await user.click(within(costs).getByText("연도별 생활비·간병비 보기"));
    const notice = within(costs).getByText("2038-10-21부터는 한 분만 계신다고 보고 생활비 61%·수입 60%로 계산했어요.");
    expect(notice).toBeVisible();
    const table = within(costs).getByRole("table", { name: "연도별 생활비·간병비" });
    expect(notice.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(within(table).getAllByRole("row")[2]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "12년차",
      "2038-10-21",
      "27,850,588원",
      "9,131,340원",
      "0원",
      "18,719,248원",
    ]);

    const basis = screen.getByText("계산 기준과 가정").closest("details")!;
    await user.click(within(basis).getByText("계산 기준과 가정"));
    expect(
      within(basis).getByText(
        "재산 연 3% · 생활비·수입·간병비 연 2% · 월 간병비 2,000,000원 · 간병 2년 · 공시가격 비율 70% · 한 분만 계실 때 생활비 61% · 수입 60%",
      ),
    ).toBeVisible();
    expect(
      within(basis).getByText("월 생활비·월 수입은 두 분 합계로 보고, 한 분만 계시게 되는 2038-10-21부터는 월 생활비를 61%, 월 수입을 60%로 계산해요."),
    ).toBeVisible();
    expect(
      within(basis).getByText("간병비는 부모님마다 예상 시점 전 마지막 2년에 들어간다고 봐요. 건강 상태가 '요양·간병 중'인 분은 지금부터 예상 시점까지 들어가요."),
    ).toBeVisible();
  });
});

describe("검토용 요약", () => {
  it("가정값 표에 한 분만 계실 때 생활비·수입 비율을 보여 준다", async () => {
    mockApi(envelope(CASE_D), RESULT_D);
    render("/succession?view=review");
    const table = await screen.findByRole("table", { name: "가정값 입력" });
    expect(
      within(table)
        .getAllByRole("row")
        .map((row) => [within(row).getByRole("rowheader").textContent, within(row).getByRole("cell").textContent]),
    ).toEqual([
      ["재산 연 증가율", "3%"],
      ["생활비·수입·간병비 연 상승률", "2%"],
      ["월 간병비", "2,000,000원"],
      ["간병 기간", "2년"],
      ["공시가격 비율", "70%"],
      ["한 분만 계실 때 생활비 비율", "61%"],
      ["한 분만 계실 때 수입 비율", "60%"],
    ]);
    const basis = screen.getByRole("region", { name: "적용 세법 기준과 출처, 계산 가정" });
    expect(within(basis).getByText(/한 분만 계실 때 생활비 61% · 수입 60%$/)).toBeVisible();
    expect(within(basis).getByText(/한 분만 계시게 되는 2038-10-21부터는 월 생활비를 61%, 월 수입을 60%로 계산해요\./)).toBeVisible();
  });

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
    const review = screen.getByRole("table", { name: "방안 비교표(전체 순위)" });
    expect(within(review).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "순위",
      "방안",
      "세금 합계(상속 시점 기준)",
      "세금 합계(낸 금액)",
      "증여세",
      "취득세",
      "양도세",
      "상속세",
      "부모님에게 남는 재산(지금)",
    ]);
    expect(within(review).getAllByRole("row")[1].textContent).toBe(
      [
        "1위",
        "부동산 증여 + 현금 10년 공제 한도 증여",
        "907,861,575원",
        "766,564,390원",
        "232,800,000원",
        "113,175,161원",
        "0원",
        "420,589,229원",
        "2,100,000,000원",
      ].join(""),
    );
    expect(review).toHaveTextContent("3위이전 가능액을 지금 현금으로 증여947,407,960원936,413,428원");
    expect(review).toHaveTextContent("4위부동산을 팔아 현금으로 지금 증여984,936,877원844,017,828원");
    expect(screen.getAllByText(/세금 계산 결과는 입력값과/).length).toBeGreaterThan(0);
    const printButton = screen.getByRole("button", { name: "인쇄·PDF로 저장" });
    expect(printButton.parentElement).toHaveClass("print:hidden");
    await user.click(printButton);
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "입력 화면으로" })).toHaveAttribute("href", "/succession");
  });
});
