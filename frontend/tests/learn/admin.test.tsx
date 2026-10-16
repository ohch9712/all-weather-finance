import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminPostEditor } from "@/features/learn/components/admin/AdminPostForm";
import { AdminPostsPage } from "@/features/learn/components/admin/AdminPostsPage";
import { authPayload, renderWithProviders } from "../utils";
import { SAMPLE_POSTS, mockLearn, mockPost } from "./mock-learn";

const admin = authPayload({ user: { role: "admin" } });

describe("관리자 학습 콘텐츠 화면", () => {
  it("일반 사용자는 권한이 없다는 화면을 보고 관리자 API를 부르지 않는다", async () => {
    const learn = mockLearn();
    renderWithProviders(<AdminPostsPage />, { route: "/admin/learn", auth: authPayload() });
    expect(await screen.findByRole("heading", { name: "권한이 없습니다" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(learn.requests.some((request) => request.includes("/admin/"))).toBe(false);

    renderWithProviders(<AdminPostEditor />, { route: "/admin/learn/new", auth: authPayload() });
    await waitFor(() => expect(screen.getAllByRole("heading", { name: "권한이 없습니다" })).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "AI 초안 만들기" })).not.toBeInTheDocument();
  });

  it("게시물 표에서 비공개 글을 공개로 바꾸고 삭제를 확인한다", async () => {
    const learn = mockLearn([...SAMPLE_POSTS(), mockPost("draft-post", { title: "초안 글", published: false, publishedAt: null })]);
    const { user } = renderWithProviders(<AdminPostsPage />, { route: "/admin/learn", auth: admin });

    const table = await screen.findByRole("table", { name: "게시물 목록" });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    expect(screen.getByRole("link", { name: "새로 만들기" })).toHaveAttribute("href", "/admin/learn/new");
    const draft = learn.posts.at(-1)!;
    expect(screen.getByRole("link", { name: "초안 글 수정" })).toHaveAttribute("href", `/admin/learn/${draft.id}/edit`);

    const toggle = screen.getByRole("switch", { name: "초안 글 공개" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole("switch", { name: "초안 글 공개" })).toHaveAttribute("aria-checked", "true"));
    expect(learn.bodies).toContainEqual({ method: "PATCH", path: `/api/learn/admin/posts/${draft.id}`, body: { published: true } });

    await user.click(screen.getByRole("button", { name: "초안 글 삭제" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("게시물을 삭제할까요?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByText("초안 글")).not.toBeInTheDocument());
    expect(learn.requests).toContain(`DELETE /api/learn/admin/posts/${draft.id}`);
  });

  it("종류에 따라 용어·영상 링크 칸을 보여 준다", async () => {
    mockLearn();
    const { user } = renderWithProviders(<AdminPostEditor />, { route: "/admin/learn/new", auth: admin });

    expect(await screen.findByRole("heading", { level: 1, name: "새 게시물" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "글" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByLabelText("용어")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("YouTube 링크")).not.toBeInTheDocument();
    expect(screen.getByLabelText("요약")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "용어" }));
    expect(screen.getByLabelText("용어")).toBeInTheDocument();
    expect(screen.getByLabelText("한 줄 정의")).toBeInTheDocument();
    expect(screen.queryByLabelText("YouTube 링크")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "영상" }));
    expect(screen.getByLabelText("YouTube 링크")).toBeInTheDocument();
    expect(screen.queryByLabelText("용어")).not.toBeInTheDocument();

    // 필수 칸을 비우고 저장하면 칸 아래에 안내한다.
    await user.click(screen.getByRole("button", { name: "만들기" }));
    expect(await screen.findByText("YouTube 링크를 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("제목을 입력해 주세요.")).toBeInTheDocument();
  });

  it("AI 초안 만들기로 폼을 채우고 aiAssisted=true로 저장한다", async () => {
    const learn = mockLearn();
    const { user, router } = renderWithProviders(<AdminPostEditor />, { route: "/admin/learn/new", auth: admin });

    await user.click(await screen.findByRole("radio", { name: "용어" }));
    expect(screen.getByText("주제는 AI 공급자로 전송돼요. 개인정보를 적지 마세요.")).toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "AI 초안" });
    expect(await within(panel).findByText("Google Gemini")).toBeInTheDocument();
    expect(within(panel).getByRole("note")).toHaveAttribute("data-variant", "ai");

    await user.type(screen.getByLabelText("주제"), "PBR");
    await user.click(screen.getByRole("button", { name: "AI 초안 만들기" }));

    await waitFor(() => expect(screen.getByLabelText("제목")).toHaveValue("PBR(주가순자산비율)"));
    expect(learn.bodies).toContainEqual({
      method: "POST",
      path: "/api/learn/admin/ai-draft",
      body: { kind: "glossary", topic: "PBR", level: "beginner" },
    });
    expect(screen.getByLabelText("용어")).toHaveValue("PBR");
    expect(screen.getByLabelText("한 줄 정의")).toHaveValue("주가가 1주당 순자산의 몇 배인지 나타내는 지표");
    expect(screen.getByLabelText("태그")).toHaveValue("지표, 가치평가");
    expect(screen.getByLabelText("본문(Markdown)")).toHaveValue("## 한마디로\n\nPBR은 …");
    expect(screen.getByRole("switch", { name: "AI 도움으로 작성" })).toHaveAttribute("aria-checked", "true");

    // 미리보기 탭은 Markdown으로 그린다.
    await user.click(screen.getByRole("tab", { name: "미리보기" }));
    expect(await screen.findByRole("heading", { level: 2, name: "한마디로" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("슬러그(주소)"), "pbr");
    await user.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin/learn"));
    expect(learn.bodies).toContainEqual({
      method: "POST",
      path: "/api/learn/admin/posts",
      body: {
        kind: "glossary",
        slug: "pbr",
        title: "PBR(주가순자산비율)",
        summary: "주가가 1주당 순자산의 몇 배인지 나타내는 지표",
        bodyMd: "## 한마디로\n\nPBR은 …",
        term: "PBR",
        videoUrl: null,
        level: "beginner",
        tags: ["지표", "가치평가"],
        published: false,
        aiAssisted: true,
      },
    });
  });

  it("AI가 꺼져 있으면 초안 버튼 대신 안내를 보여 준다", async () => {
    const learn = mockLearn(SAMPLE_POSTS(), { aiEnabled: false });
    renderWithProviders(<AdminPostEditor />, { route: "/admin/learn/new", auth: admin });

    expect(await screen.findByText(/AI 기능이 꺼져 있어 초안을 만들 수 없어요/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI 초안 만들기" })).not.toBeInTheDocument();
    expect(screen.getByText("AI 꺼짐")).toBeInTheDocument();
    expect(learn.requests.some((request) => request.includes("ai-draft"))).toBe(false);
  });

  it("영상 링크 서버 검증 실패를 칸 아래에 보여 준다", async () => {
    mockLearn();
    const { user, router } = renderWithProviders(<AdminPostEditor />, { route: "/admin/learn/new", auth: admin });

    await user.click(await screen.findByRole("radio", { name: "영상" }));
    await user.type(screen.getByLabelText("제목"), "영상 글");
    await user.type(screen.getByLabelText("요약"), "설명");
    await user.type(screen.getByLabelText("YouTube 링크"), "https://vimeo.com/1");
    await user.click(screen.getByRole("button", { name: "만들기" }));

    expect(await screen.findByText("YouTube 링크만 등록할 수 있습니다.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("수정 화면은 기존 값을 채우고 바뀐 값을 PATCH로 보낸다", async () => {
    const learn = mockLearn();
    const per = learn.posts[0];
    const { user, router } = renderWithProviders(<AdminPostEditor id={per.id} />, {
      route: `/admin/learn/${per.id}/edit`,
      auth: admin,
    });

    expect(await screen.findByRole("heading", { level: 1, name: "게시물 수정" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("용어")).toHaveValue("PER"));
    expect(screen.getByLabelText("슬러그(주소)")).toHaveValue("per");
    expect(screen.getByLabelText("태그")).toHaveValue("지표, 가치평가");

    const title = screen.getByLabelText("제목");
    await user.clear(title);
    await user.type(title, "PER 다시 쓰기");
    await user.click(screen.getByRole("button", { name: "수정 저장" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin/learn"));
    const patch = learn.bodies.find((entry) => entry.method === "PATCH");
    expect(patch?.path).toBe(`/api/learn/admin/posts/${per.id}`);
    expect(patch?.body).toMatchObject({ kind: "glossary", slug: "per", title: "PER 다시 쓰기", term: "PER", videoUrl: null });
  });
});
