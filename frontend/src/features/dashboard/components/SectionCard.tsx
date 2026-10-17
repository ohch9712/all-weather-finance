"use client";

import { useId, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, CircleAlert, RefreshCw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title: string;
  icon: LucideIcon;
  /** 머리글 오른쪽 링크(그 모듈 화면) */
  link?: { href: string; label: string };
  /** 제목 옆 배지(샘플 데이터, AI 공급자 등) */
  badge?: ReactNode;
  /** 섹션이 null이면 true. 본문 대신 "불러오지 못했어요"와 다시 시도를 보여 준다. */
  failed?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  children?: ReactNode;
}

/** 홈 카드 틀. 카드마다 이름 붙은 영역(region)이다. */
export function SectionCard({
  title,
  icon: Icon,
  link,
  badge,
  failed = false,
  onRetry,
  retrying = false,
  className,
  children,
}: SectionCardProps) {
  const headingId = useId();
  return (
    <Card role="region" aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 id={headingId} className="break-keep">
            {title}
          </h2>
          {badge}
        </CardTitle>
        {link && (
          <CardAction>
            <Link
              href={link.href}
              className="inline-flex items-center gap-0.5 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {link.label}
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </Link>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col gap-4">
        {failed ? <SectionFailed onRetry={onRetry} retrying={retrying} /> : children}
      </CardContent>
    </Card>
  );
}

function SectionFailed({ onRetry, retrying }: { onRetry?: () => void; retrying: boolean }) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
      <CircleAlert className="size-6 text-destructive" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">불러오지 못했어요</p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={cn(retrying && "animate-spin")} aria-hidden="true" />
          다시 시도
        </Button>
      )}
    </div>
  );
}

/** 카드 안의 빈 상태 한 줄과 바로가기 버튼 */
export function SectionEmpty({ message, action }: { message: string; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 py-2">
      <p className="text-sm text-muted-foreground break-keep">{message}</p>
      {action && (
        <Button asChild variant="outline" size="sm">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}
