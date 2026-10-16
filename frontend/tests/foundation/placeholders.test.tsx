import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AllocationPage from "@/app/(app)/allocation/page";
import StockDetailPage from "@/app/(app)/stocks/[code]/page";
import LedgerImportPage from "@/app/(app)/ledger/import/page";

describe("자리표시 페이지", () => {
  it.each([
    ["자산배분", AllocationPage, "02"],
    ["카드 이용내역 가져오기", LedgerImportPage, "10"],
    ["종목 상세", StockDetailPage, "12"],
  ])("%s 페이지가 담당 작업 번호를 보여 준다", (title, Page, taskId) => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(`준비 중입니다. 작업 ${taskId}에서 구현합니다.`)).toBeInTheDocument();
  });

  // 스펙 01 11.6절 표 전체: 경로마다 page.tsx가 있고 담당 작업 번호를 넘긴다.
  it.each([
    ["", "16"],
    ["allocation", "02"],
    ["allocation/survey", "02"],
    ["allocation/assets", "02"],
    ["ledger", "03"],
    ["ledger/import", "10"],
    ["journal", "05"],
    ["journal/import", "11"],
    ["chat", "09"],
    ["stocks/watchlist", "12"],
    ["stocks/[code]", "12"],
    ["stocks/screener", "13"],
    ["estate", "06"],
    ["learn", "07"],
    ["learn/glossary", "07"],
    ["learn/[slug]", "07"],
    ["admin/learn", "07"],
    ["settings/connections", "08"],
  ])("/%s → 작업 %s", (route, taskId) => {
    const source = readFileSync(join(process.cwd(), "src/app/(app)", route, "page.tsx"), "utf8");
    expect(source).toContain(`<ComingSoon title=`);
    expect(source).toContain(`taskId="${taskId}"`);
  });
});
