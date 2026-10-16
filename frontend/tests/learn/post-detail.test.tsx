import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PostDetailPage } from "@/features/learn/components/PostDetailView";
import { authPayload, renderWithProviders } from "../utils";
import { SAMPLE_POSTS, mockLearn, mockPost } from "./mock-learn";

function renderDetail(slug: string) {
  return renderWithProviders(<PostDetailPage slug={slug} />, { route: `/learn/${slug}`, auth: authPayload() });
}

const DANGEROUS_BODY = [
  "## 안전한 소제목",
  "",
  "본문 <b>굵게</b> 문단이에요.",
  "",
  '<script>window.__learnXss = true</script>',
  "",
  '<img src="x" onerror="window.__learnXss = true">',
  "",
  '<iframe src="https://evil.example.com"></iframe>',
  "",
  "[위험한 링크](javascript:alert(1)) [바깥 링크](https://example.com)",
  "",
  "| 구분 | 값 |",
  "| --- | --- |",
  "| PER | 10배 |",
].join("\n");

describe("학습 상세 화면", () => {
  it("글: Markdown 본문을 그리고 원시 HTML은 렌더링하지 않는다", async () => {
    const posts = [
      mockPost("safe-article", {
        title: "안전한 글",
        summary: "원시 HTML 시험",
        bodyMd: DANGEROUS_BODY,
        aiAssisted: true,
        tags: ["지표"],
      }),
      ...SAMPLE_POSTS(),
    ];
    const learn = mockLearn(posts);
    renderDetail("safe-article");

    expect(await screen.findByRole("heading", { level: 1, name: "안전한 글" })).toBeInTheDocument();
    const body = screen.getByTestId("markdown-body");
    expect(within(body).getByRole("heading", { level: 2, name: "안전한 소제목" })).toBeInTheDocument();
    expect(within(body).getByRole("table")).toBeInTheDocument();
    expect(body.querySelector("script, img, iframe, b")).toBeNull();
    expect(body.innerHTML).not.toContain("onerror");
    expect(body.textContent).not.toContain("__learnXss");
    expect((window as unknown as { __learnXss?: boolean }).__learnXss).toBeUndefined();
    // javascript: 주소는 지우고, 바깥 링크는 새 탭으로 연다.
    expect(within(body).getByText("위험한 링크").getAttribute("href") ?? "").not.toContain("javascript");
    expect(within(body).getByRole("link", { name: "바깥 링크" })).toHaveAttribute("target", "_blank");

    expect(screen.getByText("AI 도움으로 작성")).toBeInTheDocument();
    const notes = screen.getAllByRole("note").map((note) => note.getAttribute("data-variant"));
    expect(notes).toEqual(["investment", "ai"]);

    // 태그 링크와 태그가 겹치는 관련 게시물
    expect(screen.getByRole("link", { name: "#지표" })).toHaveAttribute("href", `/learn?tag=${encodeURIComponent("지표")}`);
    const related = screen.getByRole("region", { name: "관련 게시물" });
    expect(within(related).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/learn/per",
      "/learn/start-with-etf",
    ]);

    // 진입하면 한 번 읽음으로 표시한다.
    await waitFor(() => expect(learn.requests).toContain(`POST /api/learn/posts/${posts[0].id}/read`));
    await waitFor(() => expect(screen.getAllByText("읽음").length).toBeGreaterThan(0));
    expect(learn.requests.filter((request) => request.endsWith("/read"))).toHaveLength(1);
  });

  it("영상: youtube-nocookie 16:9 임베드와 설명을 보여 준다", async () => {
    mockLearn([mockPost("clip", { kind: "video", title: "첫 영상", summary: "영상 설명", videoId: "a-b_c-d_e-f" })]);
    renderDetail("clip");

    const frame = await screen.findByTitle("첫 영상 영상");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/a-b_c-d_e-f");
    expect(frame.parentElement).toHaveClass("aspect-video");
    expect(screen.getByText("영상 설명")).toBeInTheDocument();
    expect(screen.queryByText("AI 도움으로 작성")).not.toBeInTheDocument();
  });

  it("용어: 큰 용어명과 한 줄 정의, 북마크 버튼을 보여 준다", async () => {
    const learn = mockLearn();
    const { user } = renderDetail("per");

    expect(await screen.findByRole("heading", { level: 1, name: "PER" })).toHaveClass("text-3xl");
    expect(screen.getByText("PER(주가수익비율)")).toBeInTheDocument();
    expect(screen.getByText("주가가 1주당 순이익의 몇 배인지 나타내는 지표")).toBeInTheDocument();
    expect(screen.getByText("기초")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "북마크" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "북마크 해제" })).toHaveAttribute("aria-pressed", "true"));
    expect(learn.requests).toContain(`POST /api/learn/posts/${learn.posts[0].id}/bookmark`);
  });

  it("없거나 비공개인 게시물은 안내를 보여 주고 읽음 표시를 하지 않는다", async () => {
    const learn = mockLearn([mockPost("draft", { published: false })]);
    renderDetail("draft");
    expect(await screen.findByText("게시물을 찾을 수 없어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "학습 목록으로" })).toHaveAttribute("href", "/learn");
    expect(learn.requests.some((request) => request.endsWith("/read"))).toBe(false);
  });
});
