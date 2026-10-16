"use client";

import { useState } from "react";
import { CircleAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AiProviderBadge } from "@/components/common/AiProviderBadge";
import { Disclaimer } from "@/components/common/Disclaimer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api-client";
import { useAiStatus } from "@/lib/ai-status";
import { useAiDraft } from "../../hooks";
import type { Draft, PostKind, PostLevel } from "../../types";
import { LIMITS } from "../../utils";

interface AiDraftPanelProps {
  kind: PostKind;
  level: PostLevel;
  onDraft: (draft: Draft) => void;
}

/** 주제·종류·난이도로 AI 초안을 받아 폼을 채운다(저장은 폼에서). 개인 데이터가 없는 general 등급 작업이다. */
export function AiDraftPanel({ kind, level, onDraft }: AiDraftPanelProps) {
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const draft = useAiDraft();
  const { data: aiStatus } = useAiStatus();
  const disabled = aiStatus?.general.enabled === false;

  function generate() {
    const trimmed = topic.trim();
    if (!trimmed) {
      setError("주제를 입력해 주세요.");
      return;
    }
    setError(null);
    draft.mutate(
      { kind, topic: trimmed, level },
      {
        onSuccess: (result) => {
          onDraft(result);
          toast.success("AI 초안을 채웠어요. 저장하기 전에 내용을 꼭 검토해 주세요.");
        },
        onError: (cause) => setError(getErrorMessage(cause)),
      },
    );
  }

  return (
    <section aria-labelledby="ai-draft-heading" className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ai-draft-heading" className="flex items-center gap-1.5 font-semibold">
          <Sparkles className="size-4" aria-hidden="true" />
          AI 초안
        </h2>
        <AiProviderBadge scope="general" compact />
      </div>
      {disabled ? (
        <p className="text-sm text-muted-foreground break-keep">
          AI 기능이 꺼져 있어 초안을 만들 수 없어요. 서버에 Gemini나 로컬 AI(Ollama)를 설정하면 쓸 수 있어요.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="ai-draft-topic">주제</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="ai-draft-topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                onKeyDown={(event) => {
                  // 바깥 게시물 폼이 제출되지 않게 한다.
                  if (event.key === "Enter") {
                    event.preventDefault();
                    generate();
                  }
                }}
                maxLength={LIMITS.topic}
                placeholder="예: PBR, 분산투자가 필요한 이유"
                aria-describedby="ai-draft-topic-help"
                className="min-w-0 flex-1"
              />
              <Button type="button" onClick={generate} disabled={draft.isPending}>
                <Sparkles aria-hidden="true" />
                {draft.isPending ? "만드는 중…" : "AI 초안 만들기"}
              </Button>
            </div>
            <p id="ai-draft-topic-help" className="text-xs text-muted-foreground">
              주제는 AI 공급자로 전송돼요. 개인정보를 적지 마세요.
            </p>
          </div>
          {error && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </>
      )}
      <Disclaimer variant="ai" />
    </section>
  );
}
