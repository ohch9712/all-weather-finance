import { describe, expect, it } from "vitest";
import type { CategoryAmount, Entry } from "@/features/ledger/types";
import {
  addDays,
  buildFilterQuery,
  currentMonth,
  digitsOnly,
  formatDayHeader,
  formatMonthLabel,
  groupAmountInput,
  groupByDate,
  parseFilters,
  shiftMonth,
  toExpenseSlices,
  todayKst,
} from "@/features/ledger/utils";

describe("달·날짜", () => {
  it("KST 기준으로 오늘과 이번 달을 구한다", () => {
    expect(todayKst(new Date("2026-10-31T14:59:59Z"))).toBe("2026-10-31");
    expect(todayKst(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
    expect(currentMonth(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01");
  });

  it("달을 옮기고 이름을 붙인다", () => {
    expect(shiftMonth("2026-10", -1)).toBe("2026-09");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", -22)).toBe("2024-12");
    expect(formatMonthLabel("2026-03")).toBe("2026년 3월");
    expect(formatDayHeader("2026-10-15")).toBe("10월 15일 (목)");
    expect(formatDayHeader("2026-11-01")).toBe("11월 1일 (일)");
    expect(addDays("2026-10-16", 366)).toBe("2027-10-17");
  });
});

describe("필터 ↔ URL", () => {
  const now = new Date("2026-10-16T03:00:00Z");

  it("URL 쿼리를 읽고 잘못된 값은 기본값으로 본다", () => {
    expect(parseFilters(new URLSearchParams("month=2026-09&kind=income&categoryId=c1&q=%20마트%20"), now)).toEqual({
      month: "2026-09",
      kind: "income",
      categoryId: "c1",
      q: "마트",
    });
    expect(parseFilters(new URLSearchParams("month=2026-13&kind=transfer&categoryId=&q="), now)).toEqual({
      month: "2026-10",
      kind: null,
      categoryId: null,
      q: "",
    });
  });

  it("빈 필터는 URL에 넣지 않는다", () => {
    expect(buildFilterQuery({ month: "2026-10", kind: null, categoryId: null, q: "" })).toBe("month=2026-10");
    expect(buildFilterQuery({ month: "2026-10", kind: "expense", categoryId: "c1", q: "김밥 천국" })).toBe(
      "month=2026-10&kind=expense&categoryId=c1&q=%EA%B9%80%EB%B0%A5+%EC%B2%9C%EA%B5%AD",
    );
  });
});

describe("금액 입력", () => {
  it("숫자만 남기고 천 단위 쉼표를 붙인다", () => {
    expect(digitsOnly("1,2a3")).toBe("123");
    expect(digitsOnly("0012")).toBe("12");
    expect(groupAmountInput("1234567")).toBe("1,234,567");
    expect(groupAmountInput("1000000000000")).toBe("1,000,000,000,000");
    expect(groupAmountInput("abc")).toBe("");
  });
});

function entry(overrides: Partial<Entry>): Entry {
  return {
    cardName: null, approvalNo: null, isCancellation: false, importBatchId: null,
    id: "e",
    kind: "expense",
    occurredOn: "2026-10-15",
    amount: 1000,
    categoryId: "c",
    categoryName: "식비",
    merchant: null,
    paymentMethod: "card",
    memo: null,
    source: "manual",
    createdAt: "2026-10-15T00:00:00Z",
    updatedAt: "2026-10-15T00:00:00Z",
    ...overrides,
  };
}

describe("목록·차트 데이터", () => {
  it("날짜별로 묶고 그날 수입·지출 합계를 낸다", () => {
    const groups = groupByDate([
      entry({ id: "1", occurredOn: "2026-10-15", amount: 1000 }),
      entry({ id: "2", occurredOn: "2026-10-15", amount: 50_000, kind: "income" }),
      entry({ id: "3", occurredOn: "2026-10-15", amount: 2000 }),
      entry({ id: "4", occurredOn: "2026-10-14", amount: 500 }),
    ]);
    expect(groups.map(({ date, income, expense, entries }) => [date, income, expense, entries.length])).toEqual([
      ["2026-10-15", 50_000, 3000, 3],
      ["2026-10-14", 0, 500, 1],
    ]);
  });

  it("취소를 빼고 취소만 있는 날의 지출은 0으로 표시한다", () => {
    const groups = groupByDate([
      entry({ amount: 5000 }),
      entry({ amount: 2000, isCancellation: true }),
      entry({ occurredOn: "2026-10-14", amount: 9000, isCancellation: true }),
    ]);
    expect(groups.map((group) => group.expense)).toEqual([3000, 0]);
  });

  it("지출 카테고리를 상위 6개와 '그 외'로 나눈다", () => {
    const byCategory: CategoryAmount[] = [
      ...Array.from({ length: 8 }, (_, index) => ({
        categoryId: `c${index}`,
        name: `카테고리${index}`,
        kind: "expense" as const,
        amount: (index + 1) * 1000,
        ratio: 0,
      })),
      { categoryId: "i", name: "급여", kind: "income", amount: 9_999_999, ratio: 100 },
    ];
    const slices = toExpenseSlices(byCategory);
    expect(slices.map((slice) => [slice.label, slice.value])).toEqual([
      ["카테고리7", 8000],
      ["카테고리6", 7000],
      ["카테고리5", 6000],
      ["카테고리4", 5000],
      ["카테고리3", 4000],
      ["카테고리2", 3000],
      ["그 외", 3000],
    ]);
    expect(toExpenseSlices(byCategory.slice(0, 3)).map((slice) => slice.label)).not.toContain("그 외");
    expect(toExpenseSlices([])).toEqual([]);
  });
});
