import Link from "next/link";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { ALLOCATION_PATHS } from "../constants";

/** 출생연도·투자성향이 없을 때 보여 줄 안내(리포트·추천·상세 공통) */
export function StatusNotice({ status }: { status: "needs_profile" | "needs_assessment" }) {
  if (status === "needs_profile") {
    return (
      <EmptyState
        title="출생연도를 먼저 입력해 주세요"
        description="나이대에 따라 권장 자산배분이 달라져요."
        action={
          <Button asChild>
            <Link href="/onboarding">출생연도 입력하기</Link>
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      title="투자성향 진단을 먼저 해 주세요"
      description="6개 질문에 답하면 투자성향과 나이대에 맞는 권장 배분을 알려 드려요."
      action={
        <Button asChild>
          <Link href={ALLOCATION_PATHS.survey}>투자성향 진단하기</Link>
        </Button>
      }
    />
  );
}
