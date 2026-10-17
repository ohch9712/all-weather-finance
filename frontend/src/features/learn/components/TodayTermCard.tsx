"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToday } from "../hooks";
import { postHref } from "../utils";
import { ReadMark } from "./PostBits";

export function TodayTermCard() {
  const { data: post, isPending, isError } = useToday();
  if (isError || (!isPending && !post)) return null;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>오늘의 용어</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending || !post ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <Link href={postHref(post.slug)} className="group flex items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-lg font-semibold break-keep">
                {post.term ?? post.title}
                <ReadMark read={post.read} />
              </p>
              <p className="text-sm text-muted-foreground break-keep">{post.summary}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
