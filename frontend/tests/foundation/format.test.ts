import { describe, expect, it } from "vitest";
import {
  currentKstYear,
  formatDate,
  formatDateTime,
  formatKRW,
  formatKRWCompact,
  formatPercent,
  formatSignedKRW,
} from "@/lib/format";

describe("formatKRW", () => {
  it.each([
    [1_234_000, "1,234,000원"],
    [0, "0원"],
    [-5_000, "-5,000원"],
    [999, "999원"],
  ])("%d → %s", (value, expected) => {
    expect(formatKRW(value)).toBe(expected);
  });
});

describe("formatSignedKRW", () => {
  it.each([
    [5_000, "+5,000원"],
    [-5_000, "-5,000원"],
    [0, "0원"],
  ])("%d → %s", (value, expected) => {
    expect(formatSignedKRW(value)).toBe(expected);
  });
});

describe("formatKRWCompact(스펙 01 9절 format_krw_compact와 같은 값)", () => {
  it.each([
    [100_000_000, "1억원"],
    [123_400_000, "1.2억원"],
    [2_710_264_056, "27.1억원"],
    [56_700_000, "5,670만원"],
    [12_345_678, "1,235만원"],
    [99_995_000, "1억원"],
    [10_000, "1만원"],
    [9_999, "9,999원"],
    [0, "0원"],
    [-56_700_000, "-5,670만원"],
    [-123_400_000, "-1.2억원"],
    [-5_000, "-5,000원"],
    [149_999_999, "1.5억원"],
    [1_000_000_000_000, "10,000억원"],
  ])("%d → %s", (value, expected) => {
    expect(formatKRWCompact(value)).toBe(expected);
  });
});

describe("formatPercent", () => {
  it.each([
    [12.345, 1, "12.3%"],
    [50, 1, "50.0%"],
    [50, 0, "50%"],
    [-3.25, 2, "-3.25%"],
    [-0.04, 1, "0.0%"],
    [1234.5, 1, "1234.5%"],
  ])("formatPercent(%d, %d) → %s", (value, digits, expected) => {
    expect(formatPercent(value, digits)).toBe(expected);
  });

  it("자릿수 기본값은 1이다", () => {
    expect(formatPercent(7.25)).toBe("7.3%");
  });
});

describe("formatDate·formatDateTime(KST)", () => {
  it("날짜 문자열은 그대로 점으로 잇는다", () => {
    expect(formatDate("2026-10-16")).toBe("2026.10.16");
  });

  it("시각 문자열은 KST 날짜로 바꾼다", () => {
    expect(formatDate("2026-10-16T16:00:00Z")).toBe("2026.10.17");
  });

  it("UTC 시각을 KST로 보여 준다", () => {
    expect(formatDateTime("2026-10-16T03:21:45Z")).toBe("2026.10.16 12:21");
    expect(formatDateTime("2026-12-31T15:30:00Z")).toBe("2027.01.01 00:30");
  });

  it("해석할 수 없는 값은 그대로 돌려준다", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });

  it("KST 기준 올해를 구한다", () => {
    expect(currentKstYear(new Date("2026-12-31T15:00:00Z"))).toBe(2027);
    expect(currentKstYear(new Date("2026-12-31T14:59:59Z"))).toBe(2026);
  });
});
