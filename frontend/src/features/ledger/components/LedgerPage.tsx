"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileUp, Plus, Tags } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCategories } from "../hooks";
import type { Entry, EntryFilters } from "../types";
import { buildFilterQuery, parseFilters } from "../utils";
import { CategoryManagerDialog } from "./CategoryManagerDialog";
import { EntryFilterBar } from "./EntryFilterBar";
import { EntryFormDialog } from "./EntryFormDialog";
import { EntryList } from "./EntryList";
import { LedgerSummary } from "./LedgerSummary";
import { MonthNavigator } from "./MonthNavigator";

/** `/ledger`: 월 이동, 요약 카드·차트, 자주 쓴 곳, 내역 목록. 필터는 URL 쿼리(`?month=&kind=&categoryId=&q=`)에 둔다. */
export function LedgerPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const { data: categories = [] } = useCategories();
  const [editor, setEditor] = useState<{ open: boolean; entry: Entry | null }>({ open: false, entry: null });
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const updateFilters = useCallback(
    (next: Partial<EntryFilters>) => {
      router.replace(`${pathname}?${buildFilterQuery({ ...filters, ...next })}`, { scroll: false });
    },
    [filters, pathname, router],
  );

  return (
    <>
      <PageHeader
        title="가계부"
        description="수입·지출을 기록하고 한 달 흐름을 살펴봐요."
        actions={
          <>
            <Button type="button" onClick={() => setEditor({ open: true, entry: null })}>
              <Plus aria-hidden="true" />
              내역 추가
            </Button>
            <Button variant="outline" asChild>
              <Link href="/ledger/import">
                <FileUp aria-hidden="true" />
                카드 명세서 가져오기
              </Link>
            </Button>
          </>
        }
      />
      <div className="space-y-6">
        <MonthNavigator month={filters.month} onChange={(month) => updateFilters({ month })} />
        <LedgerSummary month={filters.month} />
        <section aria-labelledby="ledger-entries-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="ledger-entries-heading" className="text-lg font-semibold">
              내역
            </h2>
            <Button type="button" variant="outline" size="sm" onClick={() => setCategoriesOpen(true)}>
              <Tags aria-hidden="true" />
              카테고리 관리
            </Button>
          </div>
          <EntryFilterBar filters={filters} categories={categories} onChange={updateFilters} />
          <EntryList filters={filters} onSelect={(entry) => setEditor({ open: true, entry })} />
        </section>
      </div>
      <EntryFormDialog
        open={editor.open}
        onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
        entry={editor.entry}
        categories={categories}
      />
      <CategoryManagerDialog open={categoriesOpen} onOpenChange={setCategoriesOpen} />
    </>
  );
}
