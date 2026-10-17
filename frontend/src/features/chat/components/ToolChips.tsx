import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveToolStatus } from "../use-chat-stream";

export interface ToolChip {
  key: string;
  label: string;
  status: LiveToolStatus;
}

const STATUS_TEXT: Record<LiveToolStatus, string> = { running: "진행 중", ok: "완료", error: "실패" };

/** 도구 상태 칩: 진행 중 스피너 → 성공·실패 아이콘 */
export function ToolChips({ tools }: { tools: ToolChip[] }) {
  if (tools.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="도구 실행 상태">
      {tools.map((tool) => (
        <li
          key={tool.key}
          data-status={tool.status}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
            tool.status === "error" ? "border-destructive/40 text-destructive" : "text-muted-foreground",
          )}
        >
          {tool.status === "running" && <LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden="true" />}
          {tool.status === "ok" && <CircleCheck className="size-3 shrink-0" aria-hidden="true" />}
          {tool.status === "error" && <CircleX className="size-3 shrink-0" aria-hidden="true" />}
          <span className="truncate">{tool.label}</span>
          <span className="sr-only">({STATUS_TEXT[tool.status]})</span>
        </li>
      ))}
    </ul>
  );
}
