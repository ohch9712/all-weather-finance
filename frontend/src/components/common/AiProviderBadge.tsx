"use client";

import { Cloud, CloudOff, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAiStatus, type AiScope, type ScopeStatus } from "@/lib/ai-status";
import { cn } from "@/lib/utils";

interface AiProviderBadgeProps {
  scope: AiScope;
  compact?: boolean;
}

type BadgeKind = "local" | "gemini" | "off";

const BADGE: Record<BadgeKind, { label: string; tooltip: string; icon: typeof Cpu }> = {
  local: {
    label: "로컬 AI",
    tooltip: "입력한 내용은 이 서버의 로컬 AI(Ollama)가 처리하고 외부로 보내지 않아요.",
    icon: Cpu,
  },
  gemini: {
    label: "Google Gemini",
    tooltip: "입력한 내용이 Google Gemini API로 전송돼요.",
    icon: Cloud,
  },
  off: {
    label: "AI 꺼짐",
    tooltip: "서버에 AI 설정이 없어 AI 기능을 쓸 수 없어요.",
    icon: CloudOff,
  },
};

function toKind(status: ScopeStatus): BadgeKind {
  if (!status.enabled) return "off";
  return status.provider === "ollama" || status.location === "local" ? "local" : "gemini";
}

/** AI를 쓰는 화면에서 데이터가 처리되는 곳을 보여 준다. 상태를 못 불러오면 아무것도 그리지 않는다. */
export function AiProviderBadge({ scope, compact = false }: AiProviderBadgeProps) {
  const { data } = useAiStatus();
  const status = data?.[scope];
  if (!status) return null;

  const kind = toKind(status);
  const { label, tooltip, icon: Icon } = BADGE[kind];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={kind === "off" ? "secondary" : "outline"}
          tabIndex={0}
          data-kind={kind}
          className={cn(compact && "h-4 px-1.5 text-[11px]")}
        >
          {!compact && <Icon aria-hidden="true" />}
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
