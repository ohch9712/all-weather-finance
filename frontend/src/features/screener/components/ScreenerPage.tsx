"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/common/PageHeader";
import { ErrorState } from "@/components/common/ErrorState";
import { AiProviderBadge } from "@/components/common/AiProviderBadge";
import { Disclaimer } from "@/components/common/Disclaimer";
import { SampleDataBadge } from "@/components/common/SampleDataBadge";
import { useAiStatus } from "@/lib/ai-status";
import { getErrorMessage } from "@/lib/api-client";
import {
  useBrokerConditions,
  useConnections,
  useDeleteSaved,
  useParseQuery,
  useRunBrokerCondition,
  useRunScreen,
  useSavedScreens,
  useSaveScreen,
} from "../hooks";
import type { ParsedScreen, SavedScreen, ScreenFilter } from "../types";
import {
  decodeFilter,
  emptyFilter,
  encodeFilter,
  filterSchema,
} from "../utils";
import { ConditionEditor } from "./ConditionEditor";
import { ResultTable } from "./ResultTable";

const examples = [
  "코스피 중형주 중 PER 10 이하",
  "거래대금 많은 코스닥 종목",
  "ROE 15% 이상 저PBR",
  "오늘 3% 넘게 오른 종목",
];
function initial(encoded: string | null) {
  try {
    return {
      filter: encoded ? decodeFilter(encoded) : emptyFilter(),
      error: "",
    };
  } catch {
    return {
      filter: emptyFilter(),
      error: "검색 링크가 올바르지 않습니다. 직접 조건을 추가해 주세요.",
    };
  }
}
function BrokerResults({ connectionId }: { connectionId: string | null }) {
  const list = useBrokerConditions(connectionId, true);
  const run = useRunBrokerCondition();
  return (
    <div className="space-y-3">
      {list.isPending && <p role="status">조건식을 불러오는 중이에요.</p>}
      {list.error && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      )}
      {list.data?.source === "mock" && <SampleDataBadge />}
      {list.data?.items.length === 0 && <p>저장한 조건식이 없어요.</p>}
      <div className="flex flex-wrap gap-2">
        {list.data?.items.map((condition) => (
          <Button
            key={condition.seq}
            variant="outline"
            disabled={run.isPending}
            onClick={() => run.mutate({ connectionId, seq: condition.seq })}
          >
            {condition.name} 실행
          </Button>
        ))}
      </div>
      {run.isPending && <p role="status">조건식을 실행하고 있어요.</p>}
      {run.error && <ErrorState error={run.error} />}
      {run.data && <ResultTable result={run.data} />}
    </div>
  );
}
function BrokerTab() {
  const connections = useConnections(true);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  return (
    <section
      className="space-y-4 rounded-xl border p-4"
      aria-label="내 키움 조건식"
    >
      <h2 className="font-semibold">내 키움 조건식</h2>
      <p className="text-sm text-muted-foreground">
        키움 HTS에서 저장한 조건식을 조회하고 실행해요.
      </p>
      {connections.error && (
        <ErrorState
          error={connections.error}
          onRetry={() => void connections.refetch()}
        />
      )}
      <label className="block space-y-1 text-sm">
        연결 선택
        <select
          aria-label="연결 선택"
          className="h-10 w-full min-w-0 rounded-md border bg-background px-2"
          value={connectionId ?? ""}
          onChange={(e) => setConnectionId(e.target.value || null)}
        >
          <option value="">운영자 데이터</option>
          {connections.data?.items
            .filter((c) => c.provider === "kiwoom" || c.provider === "mock")
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.status === "active" ? "연결됨" : "연결 확인 필요"}
                )
              </option>
            ))}
        </select>
      </label>
      <BrokerResults
        key={connectionId ?? "operator"}
        connectionId={connectionId}
      />
    </section>
  );
}
function SavedSearches({ load }: { load: (screen: SavedScreen) => void }) {
  const saved = useSavedScreens();
  const remove = useDeleteSaved();
  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      aria-label="저장한 검색"
    >
      <h2 className="font-semibold">저장한 검색</h2>
      {saved.isPending && <p>저장한 검색을 불러오는 중이에요.</p>}
      {saved.error && (
        <ErrorState error={saved.error} onRetry={() => void saved.refetch()} />
      )}
      {remove.error && <ErrorState error={remove.error} />}
      {saved.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          자주 쓰는 조건을 저장해 보세요. 최대 20개까지 저장할 수 있어요.
        </p>
      )}
      <ul className="space-y-2">
        {saved.data?.items.map((screen) => (
          <li key={screen.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 break-all text-sm">
              {screen.name}
            </span>
            <Button size="sm" variant="outline" onClick={() => load(screen)}>
              불러오기
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate(screen.id)}
              aria-label={`${screen.name} 삭제`}
            >
              삭제
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
function ScreenWorkspace({ encoded }: { encoded: string | null }) {
  const [start] = useState(() => initial(encoded));
  const [filter, setFilter] = useState<ScreenFilter>(start.filter);
  const [query, setQuery] = useState("");
  const [parsed, setParsed] = useState<ParsedScreen | null>(null);
  const [tab, setTab] = useState("manual");
  const [saveMessage, setSaveMessage] = useState("");
  const ai = useAiStatus();
  const parse = useParseQuery();
  const run = useRunScreen();
  const save = useSaveScreen();
  const form = useForm<{ name: string }>({ defaultValues: { name: "" } });
  const started = useRef(false);
  const runMutate = run.mutate;
  useEffect(() => {
    if (encoded && !start.error && !started.current) {
      started.current = true;
      runMutate(start.filter);
    }
  }, [encoded, start, runMutate]);
  function change(next: ScreenFilter) {
    setFilter(next);
    run.reset();
    setParsed((prev) =>
      prev
        ? { ...prev, explanation: "직접 수정한 조건으로 검색합니다." }
        : null,
    );
    save.reset();
    setSaveMessage("");
  }
  function parseText(text: string) {
    setQuery(text);
    parse.mutate(text, {
      onSuccess: (data) => {
        setParsed(data);
        setFilter(filterSchema.parse(data.filter));
        run.reset();
        save.reset();
        setSaveMessage("");
      },
    });
  }
  const busy = parse.isPending || run.isPending;
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="AI 조건검색"
        description="원하는 조건을 정하고 국내 주식과 ETF를 찾아보세요."
      />
      <div
        role="tablist"
        aria-label="조건검색 방식"
        className="flex flex-wrap gap-2"
      >
        <Button
          role="tab"
          aria-selected={tab === "manual"}
          variant={tab === "manual" ? "default" : "outline"}
          onClick={() => setTab("manual")}
        >
          AI·직접 조건
        </Button>
        <Button
          role="tab"
          aria-selected={tab === "broker"}
          variant={tab === "broker" ? "default" : "outline"}
          onClick={() => setTab("broker")}
        >
          내 키움 조건식
        </Button>
      </div>
      {tab === "broker" ? (
        <BrokerTab />
      ) : (
        <>
          <section className="min-w-0 space-y-4 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">원하는 조건을 말해 보세요</h2>
              <AiProviderBadge scope="general" compact />
            </div>
            {ai.isPending && <p role="status">AI 설정을 확인하고 있어요.</p>}
            {ai.error && (
              <ErrorState error={ai.error} onRetry={() => void ai.refetch()} />
            )}
            {ai.data?.general.enabled && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  parseText(query);
                }}
              >
                <Textarea
                  aria-label="원하는 조건"
                  placeholder="시가총액 1조 이상이고 PER 10 이하인 코스피 종목"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={300}
                  required
                  disabled={busy}
                />
                <Button type="submit" disabled={busy || !query.trim()}>
                  조건 해석
                </Button>
                <div className="flex flex-wrap gap-2">
                  {examples.map((example) => (
                    <button
                      type="button"
                      key={example}
                      className="max-w-full rounded-lg bg-muted px-3 py-2 text-left text-xs break-keep"
                      disabled={busy}
                      onClick={() => parseText(example)}
                    >
                      {example}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  조건 문장은 AI 공급자로 전송돼요. 개인정보는 적지 마세요.
                </p>
              </form>
            )}
            {ai.data && !ai.data.general.enabled && (
              <p className="text-sm text-muted-foreground">
                AI가 꺼져 있어요. 직접 조건 추가로 검색할 수 있어요.
              </p>
            )}
            {parse.isPending && <p role="status">조건을 해석하고 있어요.</p>}
            {parse.error && <ErrorState error={parse.error} />}
            {start.error && (
              <p role="alert" className="text-sm text-destructive">
                {start.error}
              </p>
            )}
            {parsed && (
              <div className="space-y-2">
                <p className="text-sm">{parsed.explanation}</p>
                <Disclaimer variant="ai" />
                {parsed.unsupported.length > 0 && (
                  <div
                    role="alert"
                    className="rounded-lg border border-amber-500/50 p-3 text-sm"
                  >
                    <strong>지원하지 않는 조건이 있어요</strong>
                    <ul>
                      {parsed.unsupported.map((item, index) => (
                        <li key={index}>
                          {item.text}: {item.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <fieldset disabled={busy} className="min-w-0">
              <legend className="mb-3 font-medium">검색 조건</legend>
              <ConditionEditor
                key={parsed ? JSON.stringify(parsed.filter) : "manual"}
                filter={filter}
                onChange={change}
              />
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={busy}
                onClick={() => run.mutate(filterSchema.parse(filter))}
              >
                검색
              </Button>
              <Link
                className="text-sm underline"
                href={`/stocks/screener?f=${encodeFilter(filter)}`}
              >
                이 조건 링크
              </Link>
            </div>
          </section>
          {run.isPending && <p role="status">종목을 검색하고 있어요.</p>}
          {run.error && <ErrorState error={run.error} />}
          {run.data && (
            <ResultTable
              result={run.data}
              sort={filter.sort}
              isPending={run.isPending}
              onSort={(field, direction) => {
                const next = { ...filter, sort: { field, direction } };
                setFilter(next);
                run.mutate(next);
              }}
            />
          )}
          <form
            className="space-y-3 rounded-xl border p-4"
            onSubmit={form.handleSubmit(({ name }) => {
              setSaveMessage("");
              save.mutate(
                { name: name.trim(), queryText: query.trim() || null, filter },
                {
                  onSuccess: () => {
                    setSaveMessage("검색을 저장했어요.");
                    form.reset();
                  },
                },
              );
            })}
          >
            <h2 className="font-semibold">이 조건 저장</h2>
            <label className="block space-y-1 text-sm">
              검색 이름
              <Input
                aria-label="검색 이름"
                maxLength={40}
                {...form.register("name", {
                  required: true,
                  validate: (value) => !!value.trim(),
                })}
              />
            </label>
            {form.formState.errors.name && (
              <p role="alert" className="text-sm text-destructive">
                검색 이름을 입력해 주세요.
              </p>
            )}
            <Button
              variant="outline"
              type="submit"
              disabled={save.isPending || busy}
            >
              이 조건 저장
            </Button>
            {save.error && (
              <p role="alert" className="text-sm text-destructive">
                {getErrorMessage(save.error)}
              </p>
            )}
            {saveMessage && (
              <p role="status" className="text-sm">
                {saveMessage}
              </p>
            )}
          </form>
          <SavedSearches
            load={(screen) => {
              change(filterSchema.parse(screen.filter));
              setParsed(null);
              setQuery(screen.queryText ?? "");
              parse.reset();
            }}
          />
        </>
      )}
      <Disclaimer variant="investment" />
    </div>
  );
}
export function ScreenerPage() {
  const searchParams = useSearchParams();
  const encoded = searchParams.get("f");
  return <ScreenWorkspace key={encoded ?? "empty"} encoded={encoded} />;
}
