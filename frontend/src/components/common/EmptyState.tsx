import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-12 text-center">
      <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium break-keep">{title}</p>
        {description && <p className="text-sm text-muted-foreground break-keep">{description}</p>}
      </div>
      {action}
    </div>
  );
}
