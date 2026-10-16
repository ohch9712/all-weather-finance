"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookA, ChevronLeft, ChevronRight } from "lucide-react";
import { Disclaimer } from "@/components/common/Disclaimer";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { usePosts } from "../hooks";
import { PAGE_SIZE, buildLearnQuery, parseLearnFilters, type LearnFilters } from "../utils";
import { LearnFilterBar } from "./LearnFilterBar";
import { PostCard } from "./PostCard";
import { ProgressCard } from "./ProgressCard";
import { TodayTermCard } from "./TodayTermCard";

/** `/learn`: 진도, 오늘의 용어, 필터(URL 쿼리 `?kind=&level=&tag=&q=&bookmarked=&page=`), 카드 그리드 */
export function LearnHome() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseLearnFilters(searchParams), [searchParams]);
  const params = useMemo(
    () => ({
      kind: filters.kind,
      level: filters.level,
      tag: filters.tag,
      q: filters.q,
      bookmarked: filters.bookmarked,
      page: filters.page,
      pageSize: PAGE_SIZE,
    }),
    [filters],
  );
  const { data, isPending, isError, error, refetch, isPlaceholderData } = usePosts(params);

  const updateFilters = useCallback(
    (next: Partial<LearnFilters>) => {
      // 필터가 바뀌면 첫 쪽으로 돌아간다.
      const merged = { ...filters, page: 1, ...next };
      const query = buildLearnQuery(merged);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [filters, pathname, router],
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(filters.kind || filters.level || filters.tag || filters.q || filters.bookmarked);

  return (
    <>
      <PageHeader
        title="주린이 학습"
        description="주식 용어와 입문 글·영상으로 차근차근 배워요."
        actions={
          <Button variant="outline" asChild>
            <Link href="/learn/glossary">
              <BookA aria-hidden="true" />
              용어 사전
            </Link>
          </Button>
        }
      />
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <ProgressCard />
          <TodayTermCard />
        </div>

        <section aria-labelledby="learn-posts-heading" className="space-y-4">
          <h2 id="learn-posts-heading" className="sr-only">
            학습 게시물
          </h2>
          <LearnFilterBar filters={filters} onChange={updateFilters} />

          {isPending ? (
            <LoadingState rows={4} />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : data.items.length === 0 ? (
            <EmptyState
              title={filters.bookmarked ? "북마크한 게시물이 없어요" : "조건에 맞는 게시물이 없어요"}
              description={filtered ? "필터를 바꾸거나 검색어를 지워 보세요." : "관리자가 학습 콘텐츠를 올리면 여기에 보여요."}
              action={
                filtered ? (
                  <Button type="button" variant="outline" onClick={() => router.replace(pathname, { scroll: false })}>
                    필터 지우기
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {data.total}개
              </p>
              <ul aria-label="학습 게시물 목록" aria-busy={isPlaceholderData} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </ul>
              {totalPages > 1 && (
                <nav aria-label="쪽 이동" className="flex items-center justify-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={filters.page <= 1}
                    onClick={() => updateFilters({ page: filters.page - 1 })}
                  >
                    <ChevronLeft aria-hidden="true" />
                    이전
                  </Button>
                  <span className="text-sm tabular-nums">
                    {filters.page} / {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={filters.page >= totalPages}
                    onClick={() => updateFilters({ page: filters.page + 1 })}
                  >
                    다음
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </nav>
              )}
            </>
          )}
        </section>

        <Disclaimer variant="investment" />
      </div>
    </>
  );
}
