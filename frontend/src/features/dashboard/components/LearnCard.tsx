"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { LearnSection } from "../types";
import { learnPostHref } from "../utils";
import { SectionCard } from "./SectionCard";

interface LearnCardProps {
  data: LearnSection | null;
  onRetry: () => void;
  retrying: boolean;
}

/** 오늘의 용어(용어·한 줄 정의·자세히)와 학습 진도 막대 */
export function LearnCard({ data, onRetry, retrying }: LearnCardProps) {
  return (
    <SectionCard
      title="오늘의 용어"
      icon={BookOpen}
      link={{ href: "/learn", label: "배우기" }}
      failed={data === null}
      onRetry={onRetry}
      retrying={retrying}
    >
      {data && <LearnBody data={data} />}
    </SectionCard>
  );
}

function LearnBody({ data }: { data: LearnSection }) {
  const { today, readCount, publishedCount } = data;
  const percent = publishedCount > 0 ? Math.min(100, Math.round((readCount / publishedCount) * 100)) : 0;
  return (
    <>
      {today ? (
        <div className="space-y-2">
          <p className="text-xl font-semibold break-keep">{today.term ?? today.title}</p>
          <p className="line-clamp-3 text-sm text-muted-foreground break-keep">{today.summary}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={learnPostHref(today.slug)} aria-label={`${today.term ?? today.title} 자세히`}>
              자세히
            </Link>
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground break-keep">아직 오늘의 용어가 없어요.</p>
      )}
      <div className="mt-auto space-y-1.5 border-t pt-3">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">학습 진도</span>
          <span className="tabular-nums">
            {readCount}/{publishedCount}개 읽음
          </span>
        </div>
        <Progress value={percent} aria-label={`학습 진도 ${percent}%`} />
      </div>
    </>
  );
}
