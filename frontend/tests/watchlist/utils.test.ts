import { describe, expect, it } from "vitest";
import {
  changeTone,
  formatChange,
  formatChangeRate,
  formatPrice,
  journalRecordsHref,
  periodRange,
  stockHref,
  todayKst,
} from "@/features/stocks/utils";
import { applyOrder, moveWithinGroup } from "@/features/watchlist/utils";
import { watchlistItem } from "./fake-api";

describe("종목 유틸", () => {
  it("오늘은 KST 기준이다", () => {
    // UTC 10월 16일 15:30 = KST 10월 17일 00:30
    expect(todayKst(new Date("2026-10-16T15:30:00Z"))).toBe("2026-10-17");
    expect(todayKst(new Date("2026-10-16T14:59:00Z"))).toBe("2026-10-16");
  });

  it("차트 기간: 오늘(KST) − 기간, 1년은 365일 전", () => {
    const now = new Date("2026-10-16T15:30:00Z"); // KST 2026-10-17
    expect(periodRange("1m", now)).toEqual({ from: "2026-09-17", to: "2026-10-17" });
    expect(periodRange("3m", now)).toEqual({ from: "2026-07-17", to: "2026-10-17" });
    expect(periodRange("6m", now)).toEqual({ from: "2026-04-17", to: "2026-10-17" });
    expect(periodRange("1y", now)).toEqual({ from: "2025-10-17", to: "2026-10-17" });
    // 달마다 날 수가 달라도 그 달 마지막 날로 맞춘다.
    expect(periodRange("1m", new Date("2026-03-31T03:00:00Z")).from).toBe("2026-02-28");
    // 윤년을 지나도 365일 전이다(08 상한 366일 안).
    expect(periodRange("1y", new Date("2028-03-01T03:00:00Z"))).toEqual({ from: "2027-03-02", to: "2028-03-01" });
  });

  it("가격·등락 형식", () => {
    expect(formatPrice("102800.0000", "KOSPI")).toBe("102,800원");
    expect(formatPrice(null, "KOSPI")).toBe("—");
    expect(formatPrice("123.45", "NASDAQ")).toBe("123.45");
    expect(formatChange("-1260", "KOSPI")).toBe("-1,260원");
    expect(formatChange("0", "KOSPI")).toBeNull();
    expect(formatChangeRate(2.5)).toBe("+2.50%");
    expect(formatChangeRate(-1.21)).toBe("-1.21%");
    expect(formatChangeRate(0)).toBe("0.00%");
    expect(formatChangeRate(null)).toBe("—");
    expect([changeTone(1), changeTone(-1), changeTone(0), changeTone(null)]).toEqual(["up", "down", "flat", "flat"]);
  });

  it("주소", () => {
    expect(stockHref("005930")).toBe("/stocks/005930");
    expect(journalRecordsHref("005930")).toBe("/journal?tab=records&symbol=005930");
  });
});

describe("관심종목 순서 유틸", () => {
  it("그룹 안에서만 옮기고 끝에서는 null", () => {
    const a = watchlistItem("005930");
    const b = watchlistItem("000660", { sortOrder: 1 });
    const other = watchlistItem("069500", { groupName: "배당주" });
    const items = [a, b, other];
    expect(moveWithinGroup(items, b.id, -1)).toEqual({ groupName: "기본", ids: [b.id, a.id] });
    expect(moveWithinGroup(items, a.id, -1)).toBeNull();
    expect(moveWithinGroup(items, b.id, 1)).toBeNull();
    expect(moveWithinGroup(items, other.id, -1)).toBeNull();

    const reordered = applyOrder(items, "기본", [b.id, a.id]);
    expect(reordered.map((item) => [item.code, item.sortOrder])).toEqual([
      ["000660", 0],
      ["005930", 1],
      ["069500", 0],
    ]);
  });
});
