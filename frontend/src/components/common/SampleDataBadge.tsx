"use client";

import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DISCLAIMER_TEXT } from "./Disclaimer";

/** Mock 데이터에 붙이는 배지. 툴팁은 `sample` 고지 문구다. */
export function SampleDataBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" tabIndex={0} aria-label={`샘플 데이터: ${DISCLAIMER_TEXT.sample}`}>
          <FlaskConical aria-hidden="true" />
          샘플 데이터
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{DISCLAIMER_TEXT.sample}</TooltipContent>
    </Tooltip>
  );
}
