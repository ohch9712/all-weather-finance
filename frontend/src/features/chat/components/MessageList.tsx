import { CircleAlert, LoaderCircle } from "lucide-react";
import { ChatCard } from "../cards/registry";
import type { DisplayMessage } from "../types";
import type { LiveTurn } from "../use-chat-stream";
import { Markdown } from "./Markdown";
import { ToolChips } from "./ToolChips";

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end" data-role="user">
      <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap break-words text-primary-foreground">
        {text}
      </p>
    </div>
  );
}

interface AssistantBlockProps {
  text: string;
  tools: { key: string; label: string; status: "running" | "ok" | "error" }[];
  cards: { type: string }[];
  thinking?: boolean;
  error?: string | null;
  stopped?: boolean;
}

export function AssistantBlock({ text, tools, cards, thinking, error, stopped }: AssistantBlockProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2 pr-2 sm:pr-8" data-role="assistant">
      <ToolChips tools={tools} />
      {text && <Markdown text={text} />}
      {thinking && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          답을 만드는 중
        </p>
      )}
      {cards.length > 0 && (
        <div className="flex flex-col gap-2">
          {cards.map((card, index) => (
            <ChatCard key={index} card={card} />
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive break-keep">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      {stopped && <p className="text-xs text-muted-foreground">답변을 멈췄어요.</p>}
    </div>
  );
}

export function ServerMessage({ message }: { message: DisplayMessage }) {
  if (message.role === "user") return <UserBubble text={message.text} />;
  return (
    <AssistantBlock
      text={message.text}
      tools={message.toolCalls.map((tool, index) => ({
        key: `${tool.name}-${index}`,
        label: tool.label,
        status: tool.ok ? "ok" : "error",
      }))}
      cards={message.cards}
    />
  );
}

export function LiveTurnView({ turn }: { turn: LiveTurn }) {
  return (
    <>
      <UserBubble text={turn.question} />
      <AssistantBlock
        text={turn.text}
        tools={turn.tools.map((tool) => ({ key: tool.toolUseId, label: tool.label, status: tool.status }))}
        cards={turn.cards}
        thinking={turn.phase === "streaming" && turn.awaitingText}
        error={turn.error}
        stopped={turn.phase === "stopped"}
      />
    </>
  );
}
