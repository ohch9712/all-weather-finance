import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ComingSoon } from "@/components/common/ComingSoon";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Disclaimer } from "@/components/common/Disclaimer";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { MoneyText } from "@/components/common/MoneyText";
import { PageHeader } from "@/components/common/PageHeader";
import { SampleDataBadge } from "@/components/common/SampleDataBadge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError, NETWORK_ERROR_MESSAGE } from "@/lib/api-client";

describe("Disclaimer(architecture 13절 문구와 글자 단위로 같다)", () => {
  it.each([
    [
      "investment",
      "이 서비스의 자산배분·종목 정보는 일반적인 정보 제공과 학습을 위한 것이며 투자 권유가 아닙니다. 투자 결정과 그 결과의 책임은 본인에게 있습니다.",
    ],
    [
      "tax",
      "세금 계산 결과는 입력값과 2026년 10월 기준 세법을 단순화해 추정한 참고용입니다. 실제 신고 전에는 세무 전문가와 상담하세요.",
    ],
    ["sample", "샘플 데이터입니다. 실제 시세가 아닙니다."],
    ["ai", "AI 답변은 틀릴 수 있습니다. 중요한 결정 전에는 원문 자료를 확인하세요."],
  ] as const)("%s", (variant, text) => {
    render(<Disclaimer variant={variant} />);
    expect(screen.getByRole("note")).toHaveTextContent(text, { normalizeWhitespace: false });
    expect(screen.getByRole("note").textContent).toBe(text);
  });
});

describe("MoneyText", () => {
  it("기본은 원 단위 쉼표, 색 없음", () => {
    render(<MoneyText value={1_234_000} />);
    const text = screen.getByText("1,234,000원");
    expect(text).not.toHaveClass("text-money-up");
    expect(text).not.toHaveClass("text-money-down");
  });

  it("signed면 부호를 붙이고 양수 빨강·음수 파랑", () => {
    render(
      <>
        <MoneyText value={5_000} signed />
        <MoneyText value={-5_000} signed />
        <MoneyText value={0} signed />
      </>,
    );
    expect(screen.getByText("+5,000원")).toHaveClass("text-money-up");
    expect(screen.getByText("-5,000원")).toHaveClass("text-money-down");
    expect(screen.getByText("0원")).not.toHaveClass("text-money-up");
  });

  it("compact면 만·억 단위로 줄이고 원래 금액을 title로 둔다", () => {
    render(<MoneyText value={56_700_000} compact signed />);
    const text = screen.getByText("+5,670만원");
    expect(text).toHaveAttribute("title", "56,700,000원");
  });
});

describe("상태 컴포넌트", () => {
  it("ErrorState는 ApiError 문구를 보여 주고 다시 시도를 부른다", async () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new ApiError(0, "NETWORK_ERROR", NETWORK_ERROR_MESSAGE)} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent(NETWORK_ERROR_MESSAGE);
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("ErrorState는 ApiError가 아니면 일반 문구를 보여 준다", () => {
    render(<ErrorState error={new Error("boom")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("LoadingState·EmptyState·PageHeader·ComingSoon", () => {
    render(
      <>
        <LoadingState rows={2} />
        <EmptyState title="기록이 없어요" description="첫 기록을 남겨 보세요." action={<button>추가</button>} />
        <PageHeader title="가계부" description="수입과 지출" actions={<button>내보내기</button>} />
        <ComingSoon title="조건검색" taskId="13" />
      </>,
    );
    expect(screen.getByRole("status", { name: "불러오는 중" })).toBeInTheDocument();
    expect(screen.getByText("기록이 없어요")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "가계부" })).toBeInTheDocument();
    expect(screen.getByText("준비 중입니다. 작업 13에서 구현합니다.")).toBeInTheDocument();
  });

  it("SampleDataBadge는 sample 고지를 툴팁으로 보여 준다", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <SampleDataBadge />
      </TooltipProvider>,
    );
    await user.hover(screen.getByText("샘플 데이터"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("샘플 데이터입니다. 실제 시세가 아닙니다.");
  });
});

describe("ConfirmDialog", () => {
  it("확인을 누르면 onConfirm이 끝난 뒤 닫힌다", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmDialog
        title="기록을 지울까요?"
        description="지운 기록은 되돌릴 수 없어요."
        confirmLabel="삭제"
        destructive
        onConfirm={onConfirm}
        trigger={<button>삭제하기</button>}
      />,
    );
    await user.click(screen.getByRole("button", { name: "삭제하기" }));
    expect(await screen.findByRole("alertdialog", { name: "기록을 지울까요?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "삭제" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("취소하면 onConfirm을 부르지 않는다", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="연결을 끊을까요?"
        description="다시 연결하려면 키를 다시 입력해야 해요."
        confirmLabel="끊기"
        onConfirm={onConfirm}
        trigger={<button>연결 끊기</button>}
      />,
    );
    await user.click(screen.getByRole("button", { name: "연결 끊기" }));
    await user.click(await screen.findByRole("button", { name: "취소" }));
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});
