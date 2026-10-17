import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LearnRoute from "@/app/(app)/learn/page";
import { authPayload, memoryRouter, renderWithProviders } from "../utils";
import { mockLearn } from "./mock-learn";

function renderLearn(route = "/learn") {
  return renderWithProviders(<LearnRoute />, { route, auth: authPayload() });
}

function cardTitles() {
  const list = screen.getByRole("list", { name: "학습 게시물 목록" });
  return within(list)
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent);
}

describe("학습 목록 화면", () => {
  it("진도, 오늘의 용어, 카드 그리드와 고지를 보여 준다", async () => {
    mockLearn();
    renderLearn();

    expect(await screen.findByRole("heading", { level: 1, name: "주린이 학습" })).toBeInTheDocument();
    await waitFor(() => expect(cardTitles()).toEqual(["PER", "채권", "배당", "ETF로 시작하는 분산투자", "주식시장 첫걸음 영상"]));
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.getByText("/ 5개 읽음")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "학습 진도" })).toBeInTheDocument();

    const today = screen.getByText("오늘의 용어").closest("[data-slot=card]") as HTMLElement;
    expect(await within(today).findByRole("link", { name: /PER/ })).toHaveAttribute("href", "/learn/per");

    // 카드: 종류 아이콘, 제목 링크, 요약, 난이도, 읽음 체크, 북마크 버튼
    const perCard = screen.getAllByTestId("post-card")[0];
    expect(within(perCard).getByRole("img", { name: "용어" })).toBeInTheDocument();
    expect(within(perCard).getByRole("link", { name: "PER" })).toHaveAttribute("href", "/learn/per");
    expect(within(perCard).getByText("주가가 1주당 순이익의 몇 배인지 나타내는 지표")).toBeInTheDocument();
    expect(within(perCard).getByText("기초")).toBeInTheDocument();
    expect(within(perCard).getByText("읽음")).toBeInTheDocument();
    expect(within(perCard).getByRole("button", { name: "PER 북마크" })).toHaveAttribute("aria-pressed", "false");
    expect(within(screen.getAllByTestId("post-card")[4]).getByRole("img", { name: "영상" })).toBeInTheDocument();

    expect(screen.getByRole("note")).toHaveAttribute("data-variant", "investment");
    expect(screen.getByRole("link", { name: "용어 사전" })).toHaveAttribute("href", "/learn/glossary");
  });

  it("종류·난이도·검색·북마크 필터를 URL 쿼리에 반영하고 그 조건으로 요청한다", async () => {
    const learn = mockLearn();
    const { user, router } = renderLearn();
    await screen.findByRole("list", { name: "학습 게시물 목록" });

    await user.click(screen.getByRole("radio", { name: "용어" }));
    expect(router.replace).toHaveBeenLastCalledWith("/learn?kind=glossary", { scroll: false });
    expect(memoryRouter.search).toBe("?kind=glossary");
    await waitFor(() => expect(cardTitles()).toEqual(["PER", "채권", "배당"]));
    expect(screen.getByRole("radio", { name: "용어" })).toHaveAttribute("aria-checked", "true");
    expect(learn.requests).toContain("GET /api/learn/posts?kind=glossary&page=1&pageSize=12");

    await user.click(screen.getByRole("button", { name: "기초" }));
    expect(router.replace).toHaveBeenLastCalledWith("/learn?kind=glossary&level=basic", { scroll: false });
    await waitFor(() => expect(cardTitles()).toEqual(["PER"]));
    expect(screen.getByRole("button", { name: "기초" })).toHaveAttribute("aria-pressed", "true");

    // 같은 칩을 다시 누르면 난이도 조건을 지운다.
    await user.click(screen.getByRole("button", { name: "기초" }));
    expect(router.replace).toHaveBeenLastCalledWith("/learn?kind=glossary", { scroll: false });

    await user.type(screen.getByRole("searchbox", { name: "학습 글 검색" }), "채권");
    await user.click(screen.getByRole("button", { name: "검색" }));
    expect(router.replace).toHaveBeenLastCalledWith(`/learn?kind=glossary&q=${encodeURIComponent("채권")}`, { scroll: false });
    await waitFor(() => expect(cardTitles()).toEqual(["채권"]));

    await user.click(screen.getByRole("switch", { name: "북마크만" }));
    expect(router.replace).toHaveBeenLastCalledWith(
      `/learn?kind=glossary&q=${encodeURIComponent("채권")}&bookmarked=true`,
      { scroll: false },
    );
    expect(await screen.findByText("북마크한 게시물이 없어요")).toBeInTheDocument();
    expect(learn.requests.at(-1)).toContain("bookmarked=true");

    await user.click(screen.getByRole("button", { name: "필터 지우기" }));
    expect(router.replace).toHaveBeenLastCalledWith("/learn", { scroll: false });
  });

  it("URL 쿼리에서 필터를 읽고 알 수 없는 값은 버린다", async () => {
    const learn = mockLearn();
    renderLearn("/learn?kind=article&level=nope&tag=ETF&q=ETF&page=x");
    await waitFor(() => expect(cardTitles()).toEqual(["ETF로 시작하는 분산투자"]));
    expect(screen.getByRole("radio", { name: "글" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("searchbox", { name: "학습 글 검색" })).toHaveValue("ETF");
    expect(learn.requests).toContain(`GET /api/learn/posts?kind=article&tag=ETF&q=ETF&page=1&pageSize=12`);
  });

  it("북마크 버튼으로 북마크하고 다시 누르면 해제한다", async () => {
    const learn = mockLearn();
    const { user } = renderLearn();
    const button = await screen.findByRole("button", { name: "채권 북마크" });

    await user.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: "채권 북마크 해제" })).toHaveAttribute("aria-pressed", "true"));
    const bond = learn.posts.find((post) => post.slug === "bond")!;
    expect(learn.requests).toContain(`POST /api/learn/posts/${bond.id}/bookmark`);

    await user.click(screen.getByRole("button", { name: "채권 북마크 해제" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "채권 북마크" })).toHaveAttribute("aria-pressed", "false"));
    expect(learn.requests).toContain(`DELETE /api/learn/posts/${bond.id}/bookmark`);
  });

  it("게시물이 없으면 빈 상태를 보여 준다", async () => {
    mockLearn([]);
    renderLearn();
    expect(await screen.findByText("조건에 맞는 게시물이 없어요")).toBeInTheDocument();
  });
});
