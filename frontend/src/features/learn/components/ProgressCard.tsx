"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProgress } from "../hooks";
import { POST_KINDS } from "../types";
import { KIND_LABEL } from "../utils";

export function ProgressCard() {
  const { data, isError } = useProgress();
  if (isError) return null;
  const percent = data && data.publishedCount > 0 ? Math.round((data.readCount / data.publishedCount) * 100) : 0;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>학습 진도</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm">
                <span className="text-2xl font-semibold tabular-nums">{data.readCount}</span>
                <span className="text-muted-foreground"> / {data.publishedCount}개 읽음</span>
              </p>
              <span className="text-sm font-medium tabular-nums">{percent}%</span>
            </div>
            <Progress value={percent} aria-label="학습 진도" aria-valuetext={`${data.publishedCount}개 중 ${data.readCount}개 읽음`} />
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {POST_KINDS.map((kind) => (
                <li key={kind}>
                  {KIND_LABEL[kind]} {data.byKind[kind].read}/{data.byKind[kind].published}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
