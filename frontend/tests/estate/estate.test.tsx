import { screen, within, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, expect, it } from "vitest";
import { EstatePage } from "@/features/estate/components/EstatePage";
import { apiUrl, authPayload, renderWithProviders, server } from "../utils";
import type { Member } from "@/features/estate/types";
import { relativeScopeHint } from "@/features/estate/utils";

const member: Member = { id: "child-id", relation: "child", displayName: "첫째", birthDate: "1994-07-15", marriedOn: null, childBirthDates: [], parentDeceased: false, age: 32, isMinor: false, createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z" };
const tax = { payableTax: 4850000, steps: [{ key: "calculatedTax", label: "산출세액", amount: 5000000, note: "10% 구간" }, { key: "payableTax", label: "납부세액", amount: 4850000, note: "신고 공제 반영" }], notes: ["참고용 계산"], assumptions: ["입력한 평가액을 사용합니다."], ruleVersion: "KR-2024.01.01" };
const prefill = { assets: { financialAssets: 300000000, realEstate: 500000000, otherAssets: 0 }, spouse: false, children: [{ memberId: "child-id", displayName: "첫째", age: 32 }], grandchildren: [], priorGiftsToHeirs10y: 0, priorGiftsToNonHeirs5y: 0, priorGiftDeductions: 0, priorGiftTaxPaid: 0 };

beforeEach(() => {
  server.use(http.get(apiUrl("/api/estate/members"), () => HttpResponse.json({ items: [member] })), http.get(apiUrl("/api/estate/inheritance/prefill"), () => HttpResponse.json(prefill)));
});
function render(tab: string) { return renderWithProviders(<EstatePage />, { route: `/estate?tab=${tab}`, auth: authPayload() }); }

it("가족 추가·수정·삭제와 모든 탭의 세무 고지", async () => {
  let members = [member];
  server.use(
    http.get(apiUrl("/api/estate/members"), () => HttpResponse.json({ items: members })),
    http.post(apiUrl("/api/estate/members"), async ({ request }) => { const body = await request.json() as Partial<Member>; members = [...members, { ...member, ...body, id: "new-id" }]; return HttpResponse.json(members[1], { status: 201 }); }),
    http.patch(apiUrl("/api/estate/members/new-id"), async ({ request }) => { const body = await request.json() as Partial<Member>; members = members.map((m) => m.id === "new-id" ? { ...m, ...body } : m); return HttpResponse.json(members[1]); }),
    http.delete(apiUrl("/api/estate/members/new-id"), () => { members = members.filter((m) => m.id !== "new-id"); return new HttpResponse(null, { status: 204 }); }),
  );
  const { user } = render("family");
  expect(await screen.findByRole("heading", { name: "첫째" })).toBeVisible();
  expect(screen.getByText(/세금 계산 결과는 입력값/)).toBeVisible();
  expect(screen.getByText("2024.01.01 시행 세법 기준")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "가족 추가" }));
  let dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(relativeScopeHint)).toBeVisible();
  await user.type(within(dialog).getByLabelText(/별칭/), "둘째");
  await user.type(within(dialog).getByLabelText(/생년월일/), "2000-01-01");
  await user.click(within(dialog).getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("heading", { name: "둘째" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "수정 둘째" }));
  dialog = screen.getByRole("dialog");
  await user.clear(within(dialog).getByLabelText(/별칭/));
  await user.type(within(dialog).getByLabelText(/별칭/), "작은아이");
  await user.click(within(dialog).getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("heading", { name: "작은아이" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "삭제 작은아이" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "삭제" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "작은아이" })).not.toBeInTheDocument());
});

it("증여 기록 CRUD와 적용 공제·추정 세금", async () => {
  let gifts: Record<string, unknown>[] = [];
  server.use(
    http.get(apiUrl("/api/estate/gifts"), () => HttpResponse.json({ items: gifts })),
    http.post(apiUrl("/api/estate/gifts"), async ({ request }) => { const body = await request.json() as Record<string, unknown>; gifts = [{ ...body, id: "gift-id", computedDeduction: 50000000, computedMarriageBirthDeduction: 0, estimatedTax: 4850000 }]; return HttpResponse.json(gifts[0], { status: 201 }); }),
    http.patch(apiUrl("/api/estate/gifts/gift-id"), async ({ request }) => { gifts = [{ ...gifts[0], ...await request.json() as object }]; return HttpResponse.json(gifts[0]); }),
    http.delete(apiUrl("/api/estate/gifts/gift-id"), () => { gifts = []; return new HttpResponse(null, { status: 204 }); }),
  );
  const { user } = render("gifts");
  await user.selectOptions(await screen.findByLabelText("수증자 선택"), "child-id");
  await user.click(screen.getByRole("button", { name: "증여 기록 추가" }));
  let dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(relativeScopeHint)).toBeVisible();
  await user.clear(within(dialog).getByLabelText(/증여 금액/));
  await user.type(within(dialog).getByLabelText(/증여 금액/), "100000000");
  await user.click(within(dialog).getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("cell", { name: "100,000,000원" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "수정" }));
  dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByLabelText("신고했어요"));
  await user.click(within(dialog).getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("cell", { name: "완료" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "삭제" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "삭제" }));
  expect(await screen.findByText("증여 기록이 없어요")).toBeVisible();
});

it("공제 현황 카드와 혼인·출산 기간", async () => {
  server.use(http.get(apiUrl("/api/estate/members/child-id/deductions"), () => HttpResponse.json({ asOf: "2026-10-16", adultOn: null, pools: [{ category: "lineal_ascendant", limit: 50000000, usedWithin10y: 20000000, available: 30000000, nextResetOn: "2030-01-02" }], marriageBirth: { used: 0, available: 100000000, eligibleNow: true, windows: [{ kind: "marriage", from: "2024-10-16", to: "2028-10-16" }] } })));
  render("deductions");
  expect(await screen.findByText("첫째 · 자녀")).toBeVisible();
  expect(await screen.findByText("사용 20,000,000원 · 남음 30,000,000원")).toBeVisible();
  expect(screen.getByText(/다음 공제 회복일: 2030-01-02/)).toBeVisible();
  expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
});

it("증여세 계산 단계표와 계산 가정", async () => {
  server.use(http.post(apiUrl("/api/estate/calc/gift-tax"), async ({ request }) => { const body = await request.json() as Record<string, unknown>; expect(body.amount).toBe(100000000); return HttpResponse.json(tax); }));
  const { user } = render("gift-tax");
  await screen.findByRole("button", { name: "계산하기" });
  expect(screen.getAllByText(relativeScopeHint)[0]).toBeVisible();
  await user.click(screen.getByRole("button", { name: "계산하기" }));
  expect(await screen.findByRole("table", { name: "세금 계산 단계" })).toBeVisible();
  expect(screen.getByText("10% 구간")).toBeVisible();
  await user.click(screen.getByText("계산 가정"));
  expect(screen.getByText("입력한 평가액을 사용합니다.")).toBeVisible();
});

it("사전증여가 있는 상속세 사전 채움과 계산 요청", async () => {
  server.use(
    http.get(apiUrl("/api/estate/inheritance/prefill"), () => HttpResponse.json({
      ...prefill,
      children: [{ memberId: "child-id", displayName: "첫째", age: 35 }],
      priorGiftsToHeirs10y: 100000000,
      priorGiftsToNonHeirs5y: 0,
      priorGiftDeductions: 50000000,
      priorGiftTaxPaid: 4850000,
    })),
    http.post(apiUrl("/api/estate/calc/inheritance-tax"), async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      expect(body.priorGiftsToHeirs10y).toBe(100000000);
      expect(body.priorGiftsToNonHeirs5y).toBe(0);
      expect(body.priorGiftDeductions).toBe(50000000);
      expect(body.priorGiftTaxPaid).toBe(4850000);
      expect(body.spouseAlive).toBe(false);
      expect(body.children).toEqual([{ age: 35, disabledLifeExpectancyYears: null }]);
      return HttpResponse.json({ ...tax, payableTax: 50585500 });
    }),
  );
  const { user } = render("inheritance");
  const button = await screen.findByRole("button", { name: "내 정보로 채우기" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  expect(screen.getByLabelText(/금융재산 \(원\)/)).toHaveValue(300000000);
  expect(screen.getByLabelText(/상속인 사전증여 · 10년/)).toHaveValue(100000000);
  expect(screen.getByLabelText(/상속인 외 사전증여 · 5년/)).toHaveValue(0);
  expect(screen.getByText(/점수 계산에서 뺀 자산은 부동산/)).toBeVisible();
  expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "계산하기" }));
  expect(await screen.findByText("50,585,500원")).toBeVisible();
  expect(screen.queryByText("입력값과 허용 범위를 확인해 주세요.")).not.toBeInTheDocument();
});

it("분산 증여 타임라인과 비교 카드·차트", async () => {
  server.use(http.post(apiUrl("/api/estate/simulate/gift-plan"), () => HttpResponse.json({ endDate: "2056-12-31", schedule: [{ giftOn: "2026-10-16", age: 0, amount: 20000000, deductionType: "basic", tax: 0 }], totalGifted: 20000000, totalTax: 0, futureValue: 30000000, lumpSum: { taxBase: 0, payableTax: 0 }, assumptions: [] })));
  const { user } = render("plan");
  await user.click(await screen.findByRole("button", { name: "플랜 계산" }));
  expect(await screen.findByText("2026-10-16 · 만 0세 · 기본 공제")).toBeVisible();
  expect(screen.getByText("끝나는 날 한 번에 증여")).toBeVisible();
  expect(screen.getByRole("img", { name: "누적 증여액과 미래가치" })).toBeInTheDocument();
});

it("방향 비교 카드·최대 금액 배지·막대·상세 펼치기", async () => {
  server.use(http.post(apiUrl("/api/estate/compare"), () => HttpResponse.json({ baseDate: "2026-10-16", horizonDate: "2031-10-16", annualGrowthRate: "0", recommendedKey: "inherit_only", scenarios: [{ key: "inherit_only", label: "증여 없이 상속", gifts: [], totalGifted: 0, giftTaxTotal: 0, giftsValueAtHorizon: 0, estateAtHorizon: 800000000, inheritanceTax: 35890000, totalTax: 35890000, familyReceives: 764110000, inheritance: { taxableValue: 795000000, appliedDeduction: 560000000, taxBase: 235000000, payableTax: 35890000 } }], notes: ["참고용 비교입니다."], assumptions: [] })));
  const { user } = render("compare");
  await user.click(await screen.findByRole("button", { name: "방향 비교하기" }));
  expect(await screen.findByText("같은 가정에서 가장 많이 남는 방향")).toBeVisible();
  expect(screen.getByText("764,110,000원")).toBeVisible();
  expect(screen.getByRole("img", { name: "방향별 총 세금과 가족에게 남는 금액" })).toBeInTheDocument();
  await user.click(screen.getByText("증여 일정과 상속세 단계 펼치기"));
  expect(screen.getByText("증여 일정 없음")).toBeVisible();
  expect(screen.getByText("과세표준")).toBeVisible();
});

it("자녀 없는 경우 안내와 사전 채움 null", async () => {
  server.use(http.get(apiUrl("/api/estate/members"), () => HttpResponse.json({ items: [] })), http.get(apiUrl("/api/estate/inheritance/prefill"), () => HttpResponse.json({ ...prefill, assets: null })));
  const { user } = render("compare");
  expect(await screen.findByText("가족 탭에서 자녀를 등록하면 증여 방향을 비교할 수 있어요")).toBeVisible();
  const button = screen.getByRole("button", { name: "내 정보로 채우기" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  expect(screen.getByText("자산배분에 자산을 입력하면 자동으로 채워집니다")).toBeVisible();
});
