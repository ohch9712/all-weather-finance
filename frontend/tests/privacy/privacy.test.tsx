import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connection } from "next/server";
import PrivacyPage from "@/app/privacy/page";
import { readPrivacyValues } from "@/features/privacy/config";
import { APP_NAME } from "@/lib/site";

vi.mock("next/server", () => ({ connection: vi.fn(() => Promise.resolve()) }));

// 확인용 가짜 값이다(실제 운영자 정보가 아니다).
const ENV = {
  PRIVACY_OPERATOR_NAME: "테스트 운영자",
  PRIVACY_OFFICER_NAME: "테스트 책임자",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  PRIVACY_HOSTING_PROVIDER: "예시 호스팅",
  PRIVACY_EFFECTIVE_DATE: "2026-11-01",
};
const PLACEHOLDER_ENV: Record<string, keyof typeof ENV> = {
  "{운영자}": "PRIVACY_OPERATOR_NAME",
  "{보호책임자}": "PRIVACY_OFFICER_NAME",
  "{연락 이메일}": "PRIVACY_CONTACT_EMAIL",
  "{호스팅 업체}": "PRIVACY_HOSTING_PROVIDER",
  "{시행일}": "PRIVACY_EFFECTIVE_DATE",
};
const WARNING = "운영자 정보가 아직 설정되지 않았습니다. 이 처리방침은 공개 전 초안입니다.";

/** 스펙 19 7절 원안(마크다운)을 화면 블록(제목·문단·목록 항목·표 칸) 순서의 글자 목록으로 바꾼다. */
function specBlocks(fill: (placeholder: string) => string): string[] {
  const lines = readFileSync(join(process.cwd(), "..", "docs", "specs", "19-privacy.md"), "utf8").split("\n");
  const start = lines.indexOf("## 7. 처리방침 문구 (원안)");
  const first = lines.indexOf("---", start);
  const end = lines.indexOf("---", first + 1);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(first);
  const blocks: string[] = [];
  for (const line of lines.slice(first + 1, end)) {
    if (!line.trim()) continue;
    const heading = /^\*\*(.+)\*\*$/.exec(line);
    if (heading) blocks.push(heading[1]);
    else if (line.startsWith("|")) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      if (!cells.every((cell) => /^-+$/.test(cell))) blocks.push(...cells);
    } else if (/^\d+\. /.test(line)) blocks.push(line.replace(/^\d+\. /, ""));
    else if (line.startsWith("- ")) blocks.push(line.slice(2));
    else blocks.push(line);
  }
  return blocks.map((block) => block.replace(/\{[^}]+\}/g, (token) => fill(token)));
}

function renderedBlocks(): string[] {
  const article = screen.getByRole("article");
  return Array.from(article.querySelectorAll("h1, h2, p, li, th, td")).map((node) => node.textContent ?? "");
}

async function renderPage(env: Partial<Record<keyof typeof ENV, string>>) {
  for (const key of Object.keys(ENV) as (keyof typeof ENV)[]) vi.stubEnv(key, env[key] ?? "");
  return render(await PrivacyPage());
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(connection).mockClear();
});

describe("/privacy", () => {
  it("요청 때 환경변수를 읽어 7절 문구를 글자 그대로 보여 준다", async () => {
    await renderPage(ENV);
    expect(connection).toHaveBeenCalledTimes(1);
    expect(renderedBlocks()).toEqual(specBlocks((token) => ENV[PLACEHOLDER_ENV[token]]));
    expect(screen.getByRole("heading", { level: 1, name: "개인정보 처리방침" })).toBeInTheDocument();
    expect(screen.getByText("시행일: 2026-11-01")).toBeInTheDocument();
    expect(screen.getByText("이 처리방침은 2026-11-01부터 적용합니다. 내용이 바뀌면 시행 7일 전에 이 화면으로 알립니다.")).toBeInTheDocument();
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(미설정\)/)).not.toBeInTheDocument();
    // 서비스 이름 링크는 본문 밖 위쪽에 있다.
    expect(screen.getByRole("link", { name: APP_NAME })).toHaveAttribute("href", "/");
  });

  it("상속·증여(과제)의 민감정보 행·별도 동의 문단·암호화 항목을 보여 준다(스펙 22 13절)", async () => {
    await renderPage(ENV);
    const items = within(screen.getAllByRole("table")[0]);
    expect(items.getByRole("rowheader", { name: "민감정보(선택, 별도 동의)" }).closest("tr")).toHaveTextContent(
      "상속·증여(과제)에 입력한 부모님 건강 상태(좋음·보통·나쁨·요양 중). 별도로 동의한 경우에만 암호화해 저장합니다",
    );
    expect(items.getByRole("rowheader", { name: "이용자가 입력하거나 올린 정보" }).closest("tr")).toHaveTextContent(
      "상속·증여(과제)에 입력한 부모님 정보(나이·생활비·수입)와 재산(종류·금액·지역·대출·취득 정보)",
    );
    expect(screen.getByText(/^민감정보는 이용자가 따로 동의한 경우에만 저장합니다\./)).toHaveTextContent(
      "상속·증여(과제)에 입력한 정보는 AI 기능에 보내지 않습니다.",
    );
    expect(screen.getByText("증권사 앱키·시크릿·계좌번호, CODEF 연결 식별값, 부모님 건강 상태(민감정보)는 암호화해 저장합니다.")).toBeInTheDocument();
    expect(screen.getByText(/자녀 관점의 상속·증여 이전 방안 비교/)).toBeInTheDocument();
  });

  it("표는 표로, 목록은 목록으로 보여 준다", async () => {
    await renderPage(ENV);
    const article = screen.getByRole("article");
    const tables = within(article).getAllByRole("table");
    expect(tables).toHaveLength(5);
    expect(tables.map((table) => within(table).getAllByRole("columnheader").map((cell) => cell.textContent))).toEqual([
      ["구분", "항목"],
      ["항목", "보유 기간"],
      ["수탁자", "위탁 업무"],
      ["항목", "내용"],
      ["항목", "내용"],
    ]);
    // 좁은 화면에서는 표 영역 안에서만 가로로 스크롤한다(키보드로도 스크롤할 수 있다).
    for (const table of tables) {
      const region = table.parentElement!;
      expect(region).toHaveAttribute("role", "region");
      expect(region).toHaveAttribute("tabindex", "0");
      expect(region.className).toContain("overflow-x-auto");
    }
    const hosting = within(tables[2]).getByRole("rowheader", { name: "예시 호스팅" });
    expect(hosting.closest("tr")).toHaveTextContent("서비스 서버와 데이터베이스 운영(대한민국 서울 리전)");
    const officer = within(tables[4]);
    expect(officer.getByRole("rowheader", { name: "성명" }).closest("tr")).toHaveTextContent("테스트 책임자");
    expect(within(article).getAllByRole("list")).toHaveLength(4);
    expect(article.querySelectorAll("ol")).toHaveLength(3);
    expect(article.querySelectorAll("ul > li")).toHaveLength(4);
  });

  it("이메일은 mailto 링크, 외부 주소는 새 창 링크다", async () => {
    await renderPage(ENV);
    expect(screen.getByRole("link", { name: "privacy@example.com" })).toHaveAttribute("href", "mailto:privacy@example.com");
    const external = [
      ["https://support.google.com/policies/contact/general_privacy_form", "https://support.google.com/policies/contact/general_privacy_form"],
      ["www.kopico.go.kr", "https://www.kopico.go.kr"],
      ["privacy.kisa.or.kr", "https://privacy.kisa.or.kr"],
      ["www.spo.go.kr", "https://www.spo.go.kr"],
      ["ecrm.police.go.kr", "https://ecrm.police.go.kr"],
    ];
    for (const [name, href] of external) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("값이 비면 경고 상자를 보여 주고 빈 자리는 (미설정)으로 쓴다", async () => {
    await renderPage({});
    expect(screen.getByRole("alert")).toHaveTextContent(WARNING);
    expect(renderedBlocks()).toEqual(specBlocks(() => "(미설정)"));
    expect(screen.getByText("시행일: (미설정)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /@/ })).not.toBeInTheDocument();
  });

  it("하나라도 비거나 시행일 형식이 틀리면 경고한다", async () => {
    const { unmount } = await renderPage({ ...ENV, PRIVACY_OFFICER_NAME: "   " });
    expect(screen.getByRole("alert")).toHaveTextContent(WARNING);
    expect(within(screen.getAllByRole("table")[4]).getByRole("rowheader", { name: "성명" }).closest("tr")).toHaveTextContent("(미설정)");
    unmount();
    await renderPage({ ...ENV, PRIVACY_EFFECTIVE_DATE: "2026-02-30" });
    expect(screen.getByRole("alert")).toHaveTextContent(WARNING);
    expect(screen.getByText("시행일: (미설정)")).toBeInTheDocument();
  });

  it("환경변수 값은 앞뒤 공백을 걷고, 빈 값과 잘못된 날짜는 null이다", () => {
    expect(readPrivacyValues({ PRIVACY_OPERATOR_NAME: "  운영  ", PRIVACY_EFFECTIVE_DATE: " 2026-11-01 " })).toEqual({
      operatorName: "운영",
      officerName: null,
      contactEmail: null,
      hostingProvider: null,
      effectiveDate: "2026-11-01",
    });
    for (const value of ["2026-1-1", "20261101", "2026-13-01", "다음 달"]) {
      expect(readPrivacyValues({ PRIVACY_EFFECTIVE_DATE: value }).effectiveDate).toBeNull();
    }
  });
});

describe("운영자 정보는 서버에서만 읽는다", () => {
  const srcDir = join(process.cwd(), "src");
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }
  const files = sourceFiles(srcDir).map((path) => ({
    path: relative(srcDir, path).split(sep).join("/"),
    source: readFileSync(path, "utf8"),
  }));

  it("NEXT_PUBLIC_ 이름을 쓰지 않고, 클라이언트 컴포넌트가 처리방침 설정을 가져오지 않는다", () => {
    expect(files.filter((file) => /NEXT_PUBLIC_PRIVACY|PRIVACY_\w+/.test(file.source)).map((file) => file.path)).toEqual([
      "features/privacy/config.ts",
    ]);
    const clientImporters = files
      .filter((file) => /^["']use client["']/m.test(file.source))
      .filter((file) => /features\/privacy|\.\.\/config|\.\/config/.test(file.source))
      .map((file) => file.path);
    expect(clientImporters).toEqual([]);
    const privacyFiles = files.filter((file) => file.path.startsWith("features/privacy/") || file.path.startsWith("app/privacy/"));
    expect(privacyFiles.filter((file) => /^["']use client["']/m.test(file.source)).map((file) => file.path)).toEqual([]);
  });
});
