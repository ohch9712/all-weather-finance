"use client";

import type { KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Disclaimer } from "@/components/common/Disclaimer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const MAX_QUESTION_LENGTH = 4000;

export const LOCATION_TEXT = {
  local: "대화는 이 서버의 로컬 AI로 처리돼요. 답이 조금 느릴 수 있어요.",
  cloud: "대화 내용이 Google Gemini로 전송돼요.",
} as const;

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  /** 하루 상한을 다 썼을 때처럼 보낼 수 없는 상태 */
  disabled?: boolean;
  remaining: number | null;
  location: "local" | "cloud" | null;
}

/** 입력창: Enter 전송, Shift+Enter 줄바꿈, 전송 중 "멈추기" */
export function Composer({ value, onChange, onSend, onStop, sending, disabled, remaining, location }: ComposerProps) {
  const canSend = !sending && !disabled && value.trim().length > 0;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중 Enter는 글자 확정이므로 보내지 않는다.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (canSend) onSend();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <Textarea
          aria-label="질문 입력"
          placeholder="궁금한 것을 물어보세요"
          value={value}
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          className="max-h-40 min-h-10 resize-none"
        />
        {sending ? (
          <Button type="button" variant="outline" onClick={onStop} className="h-10 shrink-0">
            <Square className="size-3.5 fill-current" aria-hidden="true" />
            멈추기
          </Button>
        ) : (
          <Button type="button" onClick={onSend} disabled={!canSend} className="h-10 shrink-0" aria-label="보내기">
            <ArrowUp aria-hidden="true" />
            <span className="hidden sm:inline">보내기</span>
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {location && <p className="break-keep">{LOCATION_TEXT[location]}</p>}
        {remaining !== null && <p className="shrink-0">오늘 남은 횟수 {remaining.toLocaleString("ko-KR")}회</p>}
      </div>
      <Disclaimer variant="ai" />
    </div>
  );
}
