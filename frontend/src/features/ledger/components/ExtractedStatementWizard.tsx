"use client";

import { useState } from "react";
import type { ImportJob } from "@/features/imports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getErrorMessage, isApiError } from "@/lib/api-client";
import { useCommitExtractedJob, useDeleteExtractedJob, useExtractedPreview, useMapExtractedJob } from "../hooks";

const mappingLabels = { preset: "알려진 형식", synonym: "자동 인식", llm: "AI 추천", user: "직접 지정" };

export function ExtractedStatementWizard({ initialJob, onCommitted, onReset }: { initialJob: ImportJob; onCommitted: (job: ImportJob) => void; onReset: () => void }) {
  const [job, setJob] = useState(initialJob);
  const [mapping, setMapping] = useState(initialJob.mapping);
  const [step, setStep] = useState<"mapping" | "preview">("mapping");
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState(false);
  const [page, setPage] = useState(1);
  const [onlyInvalid, setOnlyInvalid] = useState(false);
  const [skipInvalid, setSkipInvalid] = useState(true);
  const map = useMapExtractedJob();
  const commit = useCommitExtractedJob();
  const remove = useDeleteExtractedJob();
  const previewQuery = useExtractedPreview(step === "preview" ? job.id : undefined, page, onlyInvalid);
  const preview = previewQuery.data ?? (page === 1 && !onlyInvalid ? job.preview : null);
  const busy = map.isPending || commit.isPending || remove.isPending;
  const selected = Object.values(mapping).filter((value) => value !== null);
  const unique = new Set(selected).size === selected.length;
  const complete = job.fields.every((field) => !field.required || mapping[field.key] != null);
  const queryExpired = isApiError(previewQuery.error) && previewQuery.error.status === 410;
  function failed(error: unknown) {
    setMessage(getErrorMessage(error));
    if (isApiError(error) && error.status === 410) setExpired(true);
  }
  async function reset() {
    try { await remove.mutateAsync(job.id); onReset(); } catch (error) {
      if (isApiError(error) && [404, 410].includes(error.status)) onReset(); else failed(error);
    }
  }
  if (expired || queryExpired) return <div role="alert" className="space-y-3"><p>업로드한 지 24시간이 지났습니다. 파일을 다시 올려 주세요.</p><Button onClick={onReset}>파일 다시 선택</Button></div>;

  return <div className="min-w-0 space-y-4 rounded-lg border p-4">
    <h2 className="font-semibold">{step === "mapping" ? "추출 결과 열 매핑" : "추출 결과 미리보기"}</h2>
    <p className="break-all text-sm">{job.fileName}</p>
    {job.warnings.map((warning, index) => <p key={index} role="status" className="break-words text-sm">{warning}</p>)}
    {message && <p role="alert" className="break-words text-destructive">{message}</p>}
    {busy && <p role="status">처리하고 있습니다…</p>}
    {step === "mapping" ? <>
      <Badge>{mappingLabels[job.mappingSource]}</Badge>
      <p className="text-sm">데이터 {job.rowCount}행 · 합계 제외 {job.skippedRowCount}행. 추출 내용을 원문과 비교하고 열을 확인해 주세요.</p>
      {job.fields.map((field) => <div key={field.key} className="min-w-0 space-y-2">
        <Label htmlFor={`extract-${field.key}`}>{field.label}{field.required && " (필수)"}</Label>
        <Select value={mapping[field.key] == null ? "none" : String(mapping[field.key])} disabled={busy} onValueChange={(value) => setMapping({ ...mapping, [field.key]: value === "none" ? null : Number(value) })}>
          <SelectTrigger id={`extract-${field.key}`} className="w-full min-w-0"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">선택 안 함</SelectItem>{job.columns.map((column) => <SelectItem key={column.index} value={String(column.index)} disabled={Object.entries(mapping).some(([key, value]) => key !== field.key && value === column.index)}>{column.index + 1}. {column.header || "제목 없음"}</SelectItem>)}</SelectContent>
        </Select>
        <p className="break-all text-xs text-muted-foreground">예시: {job.columns.find((column) => column.index === mapping[field.key])?.samples.join(" / ") || "—"}</p>
      </div>)}
      {!unique && <p role="alert">한 열은 한 필드에만 쓸 수 있습니다.</p>}
      <Button disabled={busy || !complete || !unique} onClick={async () => { try { const next = await map.mutateAsync({ id: job.id, mapping }); setJob(next); setMessage(""); setPage(1); setOnlyInvalid(false); setStep("preview"); } catch (error) { failed(error); } }}>매핑 확정</Button>
    </> : <>
      {previewQuery.isPending && !preview && <p role="status">미리보기를 불러오고 있습니다…</p>}
      {previewQuery.error && <p role="alert">{getErrorMessage(previewQuery.error)}</p>}
      {preview && <>
        <p>정상 {preview.validCount}행 · 오류 {preview.invalidCount}행</p>
        <div className="flex items-center gap-2"><Checkbox id="extract-invalid" checked={onlyInvalid} onCheckedChange={(value) => { setOnlyInvalid(value === true); setPage(1); }} /><Label htmlFor="extract-invalid">오류 행만 보기</Label></div>
        {preview.rows.map((row) => <div key={row.rowNumber} className={`min-w-0 space-y-2 rounded-lg border p-3 ${row.errors.length ? "border-destructive" : ""}`}>
          <p className="text-sm font-semibold">원본 {row.rowNumber}행{row.errors.length > 0 && " · 오류"}</p>
          <dl className="space-y-1 text-sm">{job.fields.map((field) => <div key={field.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2"><dt>{field.label}</dt><dd className="break-all">{String(row.values[field.key] ?? "—")}</dd></div>)}</dl>
          {row.errors.map((error, index) => <p key={index} className="break-words text-sm text-destructive">{job.fields.find((field) => field.key === error.field)?.label}: {error.message}</p>)}
        </div>)}
        <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={page <= 1 || previewQuery.isFetching} onClick={() => setPage(page - 1)}>이전</Button><span>{page} / {Math.max(1, Math.ceil(preview.total / preview.pageSize))}</span><Button variant="outline" disabled={page * preview.pageSize >= preview.total || previewQuery.isFetching} onClick={() => setPage(page + 1)}>다음</Button></div>
        <div className="flex items-center gap-2"><Switch id="extract-skip" checked={skipInvalid} onCheckedChange={setSkipInvalid} disabled={busy} /><Label htmlFor="extract-skip">오류 행 제외하고 저장</Label></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => setStep("mapping")}>열 매핑 수정</Button><Button disabled={busy || previewQuery.isFetching || !!previewQuery.error || (!skipInvalid && preview.invalidCount > 0)} onClick={async () => { try { const next = await commit.mutateAsync({ id: job.id, skipInvalid }); onCommitted(next); } catch (error) { failed(error); } }}>저장하기</Button></div>
      </>}
    </>}
    <Button variant="ghost" disabled={busy} onClick={() => void reset()}>취소하고 다시 시작</Button>
  </div>;
}
