import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GlossaryRoute from "@/app/(app)/learn/glossary/page";
import { authPayload, memoryRouter, renderWithProviders } from "../utils";
import { mockLearn, mockPost } from "./mock-learn";

function terms() {
  return screen.getAllByRole("listitem").map((item) => within(item).getByRole("link").firstChild?.firstChild?.textContent);
}

const TERMS = () => [
  mockPost("per", { kind: "glossary", term: "PER", summary: "주가수익비율" }),
  mockPost("bond", { kind: "glossary", term: "채권", summary: "빌려준 증서", read: true }),
  mockPost("dividend", { kind: "glossary", term: "배당", summary: "이익 나눔" }),
  mockPost("ssang", { kind: "glossary", term: "쌍봉", summary: "쌍자음 시험" }),
  mockPost("etf", { kind: "glossary", term: "ETF", summary: "상장지수펀드" }),
  mockPost("article", { kind: "article", title: "글은 사전에 없음" }),
];

describe("용어 사전 화면", () => {
  it("초성 색인 바와 가나다순 용어 목록을 보여 준다", async () => {
    mockLearn(TERMS());
    renderWithProviders(<GlossaryRoute />, { route: "/learn/glossary", auth: authPayload() });

    expect(await screen.findByRole("heading", { level: 1, name: "주식 용어 사전" })).toBeInTheDocument();
    await waitFor(() => expect(terms()).toEqual(["배당", "쌍봉", "채권", "ETF", "PER"]));
    const index = screen.getByRole("navigation", { name: "초성 색인" });
    const buttons = within(index).getAllByRole("button").map((button) => button.textContent);
    expect(buttons.slice(0, 15)).toEqual(["전체", ..."ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ"]);
    expect(buttons.slice(15, 41)).toEqual([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]);
    expect(buttons.at(-1)).toBe("#");
    expect(within(index).getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");

    // 초성 묶음 제목과 읽음 표시
    expect(screen.getByRole("heading", { level: 2, name: "ㅅ" })).toBeInTheDocument();
    const bond = screen.getByRole("link", { name: /채권/ });
    expect(bond).toHaveAttribute("href", "/learn/bond");
    expect(within(bond).getByText("읽음")).toBeInTheDocument();
  });

  it("초성을 누르면 URL과 요청에 반영하고 그 초성의 용어로 이동한다", async () => {
    const learn = mockLearn(TERMS());
    const { user, router } = renderWithProviders(<GlossaryRoute />, { route: "/learn/glossary", auth: authPayload() });
    await waitFor(() => expect(terms()).toHaveLength(5));

    await user.click(screen.getByRole("button", { name: "ㅅ" }));
    const expected = `/learn/glossary?initial=${encodeURIComponent("ㅅ")}`;
    expect(router.replace).toHaveBeenLastCalledWith(expected, { scroll: false });
    expect(memoryRouter.search).toBe(`?initial=${encodeURIComponent("ㅅ")}`);
    await waitFor(() => expect(terms()).toEqual(["쌍봉"]));
    expect(screen.getByRole("button", { name: "ㅅ" })).toHaveAttribute("aria-pressed", "true");
    expect(learn.requests).toContain(`GET /api/learn/glossary?initial=${encodeURIComponent("ㅅ")}`);

    await user.click(screen.getByRole("button", { name: "P" }));
    await waitFor(() => expect(terms()).toEqual(["PER"]));

    await user.click(screen.getByRole("button", { name: "ㄱ" }));
    expect(await screen.findByText("'ㄱ'(으)로 시작하는 용어가 없어요")).toBeInTheDocument();

    // 같은 초성을 다시 누르면 전체로 돌아간다.
    await user.click(screen.getByRole("button", { name: "ㄱ" }));
    expect(router.replace).toHaveBeenLastCalledWith("/learn/glossary", { scroll: false });
    await waitFor(() => expect(terms()).toHaveLength(5));
  });

  it("검색어를 URL과 요청에 반영한다", async () => {
    const learn = mockLearn(TERMS());
    const { user, router } = renderWithProviders(<GlossaryRoute />, { route: "/learn/glossary", auth: authPayload() });
    await waitFor(() => expect(terms()).toHaveLength(5));

    await user.type(screen.getByRole("searchbox", { name: "용어 검색" }), "펀드");
    await user.click(screen.getByRole("button", { name: "검색" }));
    expect(router.replace).toHaveBeenLastCalledWith(`/learn/glossary?q=${encodeURIComponent("펀드")}`, { scroll: false });
    await waitFor(() => expect(terms()).toEqual(["ETF"]));
    expect(learn.requests).toContain(`GET /api/learn/glossary?q=${encodeURIComponent("펀드")}`);
  });
});
