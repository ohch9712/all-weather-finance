"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api-client";

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
}

/** API 에러를 보여 준다. 문구는 `ApiError.message`(서버가 보낸 한국어 문구, 네트워크·타임아웃 안내 포함)다. */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 px-4 py-10 text-center"
    >
      <CircleAlert className="size-8 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">문제가 생겼어요</p>
        <p className="text-sm text-muted-foreground break-keep">{getErrorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button type="button" variant="outline" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          다시 시도
        </Button>
      )}
    </div>
  );
}
