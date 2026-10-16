import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarChart } from "@/components/charts/BarChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { LineChart } from "@/components/charts/LineChart";
import { assetColor, seriesColor } from "@/components/charts/palette";
import { formatKRW } from "@/lib/format";

function hiddenTable(name: string) {
  const table = screen.getByRole("table", { name });
  expect(table).toHaveClass("sr-only");
  return within(table)
    .getAllByRole("row")
    .map((row) => Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent));
}

describe("차트 래퍼", () => {
  it("DonutChart는 aria-label이 붙은 그림과 같은 데이터의 숨김 표(비중 포함)를 그린다", () => {
    render(
      <DonutChart
        ariaLabel="자산군별 비중"
        centerLabel="총 1,000만원"
        valueFormatter={formatKRW}
        data={[
          { key: "stock", label: "주식", value: 6_000_000, color: assetColor("stock") },
          { key: "bond", label: "채권", value: 3_000_000, color: assetColor("bond") },
          { key: "cash", label: "현금성 자산", value: 1_000_000, color: assetColor("cash") },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "자산군별 비중" })).toBeInTheDocument();
    expect(screen.getByText("총 1,000만원")).toBeInTheDocument();
    expect(hiddenTable("자산군별 비중")).toEqual([
      ["항목", "값", "비중"],
      ["주식", "6,000,000원", "60.0%"],
      ["채권", "3,000,000원", "30.0%"],
      ["현금성 자산", "1,000,000원", "10.0%"],
    ]);
  });

  it("BarChart는 계열마다 열이 있는 숨김 표를 그린다", () => {
    render(
      <BarChart
        ariaLabel="월별 수입과 지출"
        xKey="month"
        valueFormatter={formatKRW}
        series={[
          { key: "income", label: "수입", color: seriesColor(0) },
          { key: "expense", label: "지출", color: seriesColor(1) },
        ]}
        data={[
          { month: "9월", income: 3_000_000, expense: 2_100_000 },
          { month: "10월", income: 3_200_000, expense: 2_500_000 },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "월별 수입과 지출" })).toBeInTheDocument();
    expect(hiddenTable("월별 수입과 지출")).toEqual([
      ["항목", "수입", "지출"],
      ["9월", "3,000,000원", "2,100,000원"],
      ["10월", "3,200,000원", "2,500,000원"],
    ]);
  });

  it("LineChart는 숨김 표를 그리고 값이 없는 칸은 -로 둔다", () => {
    render(
      <LineChart
        ariaLabel="배분 점수 추이"
        xKey="date"
        series={[{ key: "score", label: "점수", color: seriesColor(0) }]}
        data={[
          { date: "10.01", score: 72 },
          { date: "10.08", score: null },
        ]}
      />,
    );
    expect(hiddenTable("배분 점수 추이")).toEqual([
      ["항목", "점수"],
      ["10.01", "72"],
      ["10.08", "-"],
    ]);
  });

  it("차트 색은 CSS 변수를 그대로 쓰고 계열 색은 돌려 쓰지 않는다", () => {
    expect(assetColor("gold")).toBe("var(--asset-gold)");
    expect(seriesColor(0)).toBe("var(--chart-1)");
    expect(seriesColor(5)).toBe("var(--chart-6)");
    expect(seriesColor(6)).toBe("var(--asset-cash)");
  });
});
