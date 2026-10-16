import { Construction } from "lucide-react";
import { PageHeader } from "./PageHeader";

interface ComingSoonProps {
  title: string;
  /** 이 화면을 구현할 작업 번호. 예: "02" */
  taskId: string;
}

/** 자리표시 페이지 본문. 담당 작업이 페이지 파일을 교체한다. */
export function ComingSoon({ title, taskId }: ComingSoonProps) {
  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-16 text-center">
        <Construction className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground break-keep">준비 중입니다. 작업 {taskId}에서 구현합니다.</p>
      </div>
    </>
  );
}
