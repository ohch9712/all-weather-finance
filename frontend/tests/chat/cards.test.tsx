import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatCard, hasCardRenderer } from "@/features/chat/cards/registry";

describe("카드 렌더러 레지스트리", () => {
  it("key_value 카드", () => {
    render(
      <ChatCard
        card={{
          type: "key_value",
          title: "내 프로필",
          items: [
            { label: "나이대", value: "30대" },
            { label: "출생연도", value: "1994년" },
          ],
        }}
      />,
    );
    expect(screen.getByText("내 프로필")).toBeInTheDocument();
    expect(screen.getByText("나이대").tagName).toBe("DT");
    expect(screen.getByText("30대").tagName).toBe("DD");
  });

  it("table 카드: 열 정렬과 각주", () => {
    render(
      <ChatCard
        card={{
          type: "table",
          title: "자산군별 비중",
          columns: [
            { key: "name", label: "자산군" },
            { key: "weight", label: "비중", align: "right" },
          ],
          rows: [
            { name: "주식", weight: "60%" },
            { name: "채권", weight: "30%" },
          ],
          footnote: "2026.10.16 기준",
        }}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "비중" })).toHaveClass("text-right");
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("60%")).toHaveClass("text-right");
    expect(screen.getByText("2026.10.16 기준")).toBeInTheDocument();
  });

  it("link 카드는 앱 내부 경로만 그린다", () => {
    const { container } = render(
      <>
        <ChatCard card={{ type: "link", title: "자산배분 보기", description: "권장 배분 확인", href: "/allocation" }} />
        <ChatCard card={{ type: "link", title: "외부", href: "https://example.com" }} />
        <ChatCard card={{ type: "link", title: "프로토콜 상대", href: "//example.com" }} />
      </>,
    );
    expect(screen.getByRole("link", { name: /자산배분 보기/ })).toHaveAttribute("href", "/allocation");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("모르는 타입은 무시한다", () => {
    const { container } = render(<ChatCard card={{ type: "donut_chart" }} />);
    expect(container).toBeEmptyDOMElement();
    expect(hasCardRenderer("key_value")).toBe(true);
    expect(hasCardRenderer("toString")).toBe(false);
  });
});
