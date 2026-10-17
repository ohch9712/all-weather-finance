"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getErrorMessage } from "@/lib/api-client";
import { formatDate, formatKRW } from "@/lib/format";
import { useCategories, useEntries, useLedgerImportJob, useReviewCategory } from "../hooks";
import type { Category, Entry } from "../types";

function ReviewEntry({ entry, categories }: { entry: Entry; categories: Category[] }) {
  const [all, setAll] = useState(false);
  const mutation = useReviewCategory();
  return <article className="min-w-0 space-y-3 rounded-lg border p-4">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><p className="min-w-0 break-all font-medium">{entry.merchant || "사용처 없음"}</p>{entry.isCancellation && <Badge variant="outline">취소 거래</Badge>}</div>
    <p className="break-words text-sm">{formatDate(entry.occurredOn)} · {entry.isCancellation ? "−" : ""}{formatKRW(entry.amount)}{entry.cardName && ` · ${entry.cardName}`}</p>
    <Label htmlFor={`category-${entry.id}`}>카테고리</Label>
    <Select value={entry.categoryId} disabled={mutation.isPending} onValueChange={(categoryId) => mutation.mutate({ entry, categoryId, all })}>
      <SelectTrigger id={`category-${entry.id}`} className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent>
    </Select>
    <div className="flex items-start gap-2"><Checkbox id={`all-${entry.id}`} checked={all} disabled={!entry.merchant || mutation.isPending} onCheckedChange={(value) => setAll(value === true)} /><Label htmlFor={`all-${entry.id}`} className="leading-5">같은 가맹점 모두 바꾸기</Label></div>
    {mutation.isPending && <p role="status" className="text-sm">분류를 저장하고 있습니다…</p>}
    {mutation.error && <p role="alert" className="break-words text-sm text-destructive">{getErrorMessage(mutation.error)}</p>}
  </article>;
}

export function LedgerImportReview() {
  const batch = useSearchParams().get("batch") || "";
  const [page, setPage] = useState(1);
  const entries = useEntries({ month: "", kind: null, categoryId: null, q: "", page, pageSize: 100, importBatchId: batch });
  const categories = useCategories();
  const job = useLedgerImportJob(batch || undefined);
  const groups = Map.groupBy(entries.data?.items ?? [], (entry) => entry.categoryName);
  if (!batch) return <p role="alert">가져오기 묶음이 없습니다. <Link href="/ledger/import">파일 가져오기</Link>에서 시작해 주세요.</p>;
  return <div className="min-w-0 space-y-6">
    <PageHeader title="가져온 내역 확인" description="분류를 바꾸면 다음 가져오기에도 같은 가맹점 규칙을 적용합니다." />
    {job.data?.result && <p role="status">저장 {job.data.result.inserted}건 · 중복 {job.data.result.skippedDuplicates}건 · 실패 {job.data.result.failed}건</p>}
    {job.data?.result?.errors.map((error, index) => <p key={index} className="break-words text-sm text-destructive">원본 {error.rowNumber}행: {error.message}</p>)}
    {entries.isPending || categories.isPending ? <p role="status">내역을 불러오고 있습니다…</p> : entries.error || categories.error ? <p role="alert">{getErrorMessage(entries.error || categories.error)}</p> : <>
      {!entries.data?.total && <p>이번 묶음에서 저장한 내역이 없습니다.</p>}
      {[...groups].map(([category, items]) => <section key={category} className="min-w-0 space-y-3"><h2 className="font-semibold">{category} · {items.length}건</h2>{items.map((entry) => <ReviewEntry key={entry.id} entry={entry} categories={categories.data?.filter((item) => item.kind === "expense") ?? []} />)}</section>)}
      {(entries.data?.total ?? 0) > 100 && <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page === 1 || entries.isFetching} onClick={() => setPage(page - 1)}>이전</Button><span>{page} / {Math.ceil((entries.data?.total ?? 0) / 100)}</span><Button variant="outline" disabled={page * 100 >= (entries.data?.total ?? 0) || entries.isFetching} onClick={() => setPage(page + 1)}>다음</Button></div>}
    </>}
    <Link href="/ledger" className="text-sm underline">가계부 요약 보기</Link>
  </div>;
}
