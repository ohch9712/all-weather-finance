"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { Disclaimer } from "@/components/common/Disclaimer";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useGlossary } from "../hooks";
import type { GlossaryItem } from "../types";
import { GLOSSARY_INITIALS, buildGlossaryQuery, parseGlossaryFilters, postHref, type GlossaryFilters } from "../utils";
import { ReadMark } from "./PostBits";

function groupByInitial(items: GlossaryItem[]) {
  const groups: { initial: string; items: GlossaryItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.initial === item.initial) last.items.push(item);
    else groups.push({ initial: item.initial, items: [item] });
  }
  return groups;
}

/** `/learn/glossary`: 초성 색인 바(ㄱ~ㅎ, A~Z, #), 검색, 가나다순 용어 목록. 필터는 URL 쿼리(`?initial=&q=`)에 둔다. */
export function GlossaryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseGlossaryFilters(searchParams), [searchParams]);
  const { data: items, isPending, isError, error, refetch } = useGlossary(filters);
  const [query, setQuery] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (syncedQ !== filters.q) {
    setSyncedQ(filters.q);
    setQuery(filters.q);
  }

  const update = useCallback(
    (next: Partial<GlossaryFilters>) => {
      const search = buildGlossaryQuery({ ...filters, ...next });
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [filters, pathname, router],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    update({ q: query.trim() });
  }

  const groups = useMemo(() => groupByInitial(items ?? []), [items]);

  return (
    <>
      <PageHeader
        title="주식 용어 사전"
        description="처음 보는 주식 용어를 초성으로 찾아보세요."
        actions={
          <Button variant="outline" asChild>
            <Link href="/learn">
              <ArrowLeft aria-hidden="true" />
              학습 목록
            </Link>
          </Button>
        }
      />
      <div className="space-y-4">
        <form role="search" onSubmit={submit} className="flex gap-2">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="용어나 뜻으로 검색"
            aria-label="용어 검색"
            maxLength={100}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="outline">
            <Search aria-hidden="true" />
            검색
          </Button>
        </form>

        <nav aria-label="초성 색인" className="flex flex-wrap gap-1">
          <IndexButton label="전체" active={filters.initial === null} onClick={() => update({ initial: null })} />
          {GLOSSARY_INITIALS.map((initial) => (
            <IndexButton
              key={initial}
              label={initial}
              active={filters.initial === initial}
              onClick={() => update({ initial: filters.initial === initial ? null : initial })}
            />
          ))}
        </nav>

        {isPending ? (
          <LoadingState rows={5} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            title={filters.initial ? `'${filters.initial}'(으)로 시작하는 용어가 없어요` : "찾는 용어가 없어요"}
            description="다른 초성을 고르거나 검색어를 바꿔 보세요."
          />
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.initial} aria-labelledby={`glossary-${group.initial}`} className="space-y-2">
                <h2 id={`glossary-${group.initial}`} className="text-lg font-semibold">
                  {group.initial}
                </h2>
                <ul className="divide-y rounded-xl border">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={postHref(item.slug)}
                        className="flex min-w-0 items-start gap-3 px-4 py-3 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium break-keep">{item.term}</span>
                          <span className="block text-sm text-muted-foreground break-keep">{item.summary}</span>
                        </span>
                        <ReadMark read={item.read} className="mt-0.5 shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        <Disclaimer variant="investment" />
      </div>
    </>
  );
}

function IndexButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
