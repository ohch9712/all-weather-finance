import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ComingSoon 렌더링 자체는 common-components.test.tsx에서 검사한다.
describe("자리표시 페이지", () => {
  // 스펙 01 11.6절 표 전체: 경로마다 page.tsx가 있다. 아직 자리표시인 페이지는 담당 작업 번호를 넘긴다.
  // 담당 작업이 페이지를 실제 화면으로 바꾸면 번호 검사는 건너뛴다.
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
    ["settings/trading-costs", "05b"],
  ])("/%s → 작업 %s", (route, taskId) => {
    const file = join(process.cwd(), "src/app/(app)", route, "page.tsx");
    expect(existsSync(file)).toBe(true);
    const source = readFileSync(file, "utf8");
    if (source.includes("<ComingSoon")) {
      expect(source).toContain(`taskId="${taskId}"`);
    }
  });
});
