"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ENTRY_KINDS, type Category, type EntryFilters, type EntryKind } from "../types";
import { KIND_LABEL } from "../utils";

const ALL = "all";
export const SEARCH_DEBOUNCE_MS = 300;

interface EntryFilterBarProps {
  filters: EntryFilters;
  categories: Category[];
  onChange: (next: Partial<EntryFilters>) => void;
}

/** 검색어는 입력을 멈추고 300ms 뒤에 URL에 반영한다. */
function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  // 뒤로 가기처럼 URL이 밖에서 바뀌면 입력값도 맞춘다.
  if (value !== synced) {
    setSynced(value);
    if (value !== text.trim()) setText(value);
  }
  const commit = useEffectEvent((q: string) => onChange(q));

  useEffect(() => {
    const next = text.trim();
    if (next === value) return;
    const timer = setTimeout(() => commit(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, value]);

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-64">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        type="search"
        aria-label="사용처·메모 검색"
        placeholder="사용처·메모 검색"
        maxLength={100}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="pl-8"
      />
    </div>
  );
}

/** 종류 탭(전체/수입/지출), 카테고리 선택, 검색어 */
export function EntryFilterBar({ filters, categories, onChange }: EntryFilterBarProps) {
  const kinds: EntryKind[] = filters.kind ? [filters.kind] : [...ENTRY_KINDS];

  function changeKind(value: string) {
    const kind = value === "income" || value === "expense" ? value : null;
    const category = categories.find((item) => item.id === filters.categoryId);
    // 고른 카테고리가 새 종류와 맞지 않으면 카테고리 필터를 푼다.
    const keepCategory = !kind || !category || category.kind === kind;
    onChange({ kind, ...(keepCategory ? {} : { categoryId: null }) });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Tabs value={filters.kind ?? ALL} onValueChange={changeKind}>
        <TabsList aria-label="종류">
          <TabsTrigger value={ALL}>전체</TabsTrigger>
          <TabsTrigger value="income">수입</TabsTrigger>
          <TabsTrigger value="expense">지출</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex min-w-0 gap-2">
        <Select
          value={filters.categoryId ?? ALL}
          onValueChange={(value) => onChange({ categoryId: value === ALL ? null : value })}
        >
          <SelectTrigger aria-label="카테고리" className="w-36 shrink-0">
            <SelectValue placeholder="전체 카테고리" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL}>전체 카테고리</SelectItem>
            {kinds.map((kind) => (
              <SelectGroup key={kind}>
                <SelectLabel>{KIND_LABEL[kind]}</SelectLabel>
                {categories
                  .filter((category) => category.kind === kind)
                  .map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <SearchBox value={filters.q} onChange={(q) => onChange({ q })} />
      </div>
    </div>
  );
}
