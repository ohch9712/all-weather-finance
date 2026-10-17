"use client";

import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { POST_KINDS, POST_LEVELS, type PostKind } from "../types";
import { KIND_LABEL, LEVEL_LABEL, SUGGESTED_TAGS, type LearnFilters } from "../utils";

const ALL_TAGS = "__all__";
const KIND_TABS: { value: PostKind | null; label: string }[] = [
  { value: null, label: "전체" },
  ...POST_KINDS.map((kind) => ({ value: kind, label: KIND_LABEL[kind] })),
];

interface LearnFilterBarProps {
  filters: LearnFilters;
  onChange: (next: Partial<LearnFilters>) => void;
}

export function LearnFilterBar({ filters, onChange }: LearnFilterBarProps) {
  // 검색어는 제출할 때 URL에 반영한다. URL이 바뀌면(뒤로 가기 등) 입력칸도 따라간다.
  const [query, setQuery] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (syncedQ !== filters.q) {
    setSyncedQ(filters.q);
    setQuery(filters.q);
  }
  const tags: string[] = [...SUGGESTED_TAGS];
  if (filters.tag && !tags.includes(filters.tag)) tags.unshift(filters.tag);

  function submit(event: FormEvent) {
    event.preventDefault();
    onChange({ q: query.trim() });
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="종류" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1 sm:inline-grid">
        {KIND_TABS.map((tab) => {
          const active = filters.kind === tab.value;
          return (
            <button
              key={tab.label}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ kind: tab.value })}
              className={cn(
                "h-8 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                active && "bg-background text-foreground shadow-sm",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="난이도" className="flex flex-wrap gap-1.5">
          {POST_LEVELS.map((level) => {
            const active = filters.level === level;
            return (
              <Button
                key={level}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                className="rounded-full"
                onClick={() => onChange({ level: active ? null : level })}
              >
                {LEVEL_LABEL[level]}
              </Button>
            );
          })}
        </div>
        <Select value={filters.tag ?? ALL_TAGS} onValueChange={(value) => onChange({ tag: value === ALL_TAGS ? null : value })}>
          <SelectTrigger size="sm" aria-label="태그" className="w-32">
            <SelectValue placeholder="모든 태그" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL_TAGS}>모든 태그</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag} value={tag}>
                #{tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch
            id="learn-bookmarked"
            checked={filters.bookmarked}
            onCheckedChange={(checked) => onChange({ bookmarked: checked })}
          />
          <Label htmlFor="learn-bookmarked">북마크만</Label>
        </div>
      </div>

      <form role="search" onSubmit={submit} className="flex gap-2">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="제목·용어·내용 검색"
          aria-label="학습 글 검색"
          maxLength={100}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="outline">
          <Search aria-hidden="true" />
          검색
        </Button>
      </form>
    </div>
  );
}
