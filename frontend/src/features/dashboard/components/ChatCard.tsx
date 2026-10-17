"use client";

import { Bot, MessageCircle } from "lucide-react";
import { AiProviderBadge } from "@/components/common/AiProviderBadge";
import { Button } from "@/components/ui/button";
import { openChatWidget } from "@/features/chat";
import type { ChatSection } from "../types";
import { CHAT_EXAMPLE_QUESTIONS } from "../utils";
import { SectionCard } from "./SectionCard";

/** AI 상담 바로가기. 예시 질문을 누르면 챗봇 위젯을 열고 입력창에 채운다(전송은 사용자가 한다). */
export function ChatCard({ data }: { data: ChatSection }) {
  return (
    <SectionCard
      title="AI 상담"
      icon={Bot}
      link={{ href: "/chat", label: "대화 목록" }}
      badge={<AiProviderBadge scope="personal" compact />}
    >
      {data.enabled ? (
        <p className="text-sm text-muted-foreground break-keep">
          내 자산·가계부·매매 기록을 바탕으로 물어보세요. 궁금한 질문을 눌러 시작할 수 있어요.
        </p>
      ) : (
        <p role="note" className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground break-keep">
          AI 상담이 꺼져 있어요. 서버에 로컬 AI(Ollama)를 설정하면 쓸 수 있어요.
        </p>
      )}
      <ul className="space-y-2">
        {CHAT_EXAMPLE_QUESTIONS.map((question) => (
          <li key={question}>
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-start py-2 text-left whitespace-normal break-keep"
              disabled={!data.enabled}
              onClick={() => openChatWidget({ draft: question })}
            >
              <MessageCircle aria-hidden="true" />
              <span className="min-w-0 flex-1">{question}</span>
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
