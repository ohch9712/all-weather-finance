"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue, useStockSearch } from "../hooks";
import type { StockSummary } from "../types";
import { EtfBadge } from "./StockBits";

interface StockSearchComboboxProps {
  /** 결과를 고르면 부른다. 고른 뒤 입력을 비운다. */
  onSelect: (stock: StockSummary) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** 종목 검색 콤보박스. 입력 300ms 뒤 `GET /api/market/stocks?q=`로 찾고 시장·업종을 함께 보여 준다. */
export function StockSearchCombobox({
  onSelect,
  label = "종목 검색",
  placeholder = "종목명 또는 코드로 검색",
  disabled = false,
  className,
}: StockSearchComboboxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const search = useStockSearch(debounced);
  const results = debounced ? (search.data?.items ?? []) : [];
  const waiting = query.trim() !== debounced || search.isFetching;
  const showList = open && query.trim().length > 0;

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  // 입력이 포커스를 잃어도 바로 닫지 않는다. 터치·자동화 클릭처럼 결과를 누르기 전에 blur가 먼저 와도 고를 수 있게 한다.
  function closeSoon() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  useEffect(() => cancelClose, []);

  function choose(stock: StockSummary) {
    cancelClose();
    onSelect(stock);
    setQuery("");
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (results.length ? (index + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
    } else if (event.key === "Enter") {
      if (showList && results[active]) {
        event.preventDefault();
        choose(results[active]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className={cn("relative w-full", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        className="pl-8"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onBlur={closeSoon}
        onKeyDown={handleKeyDown}
      />
      {showList && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
          <ul id={listId} role="listbox" aria-label={`${label} 결과`} className="max-h-72 overflow-y-auto p-1">
            {results.map((stock, index) => (
              <li
                key={stock.code}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm",
                  index === active && "bg-muted",
                )}
                // 입력의 blur보다 먼저 고르게 한다.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(stock)}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{stock.name}</span>
                    <EtfBadge kind={stock.kind} />
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {stock.code} · {stock.market}
                    {stock.sector ? ` · ${stock.sector}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {results.length === 0 && (
            <p role="status" className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              {waiting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  검색 중…
                </>
              ) : search.isError ? (
                getErrorMessage(search.error)
              ) : (
                "검색 결과가 없어요."
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
