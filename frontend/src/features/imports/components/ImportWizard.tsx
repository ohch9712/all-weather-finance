"use client";

import { useRef, useState } from "react";
import { AiProviderBadge } from "@/components/common/AiProviderBadge";
import { Disclaimer } from "@/components/common/Disclaimer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getErrorMessage, isApiError } from "@/lib/api-client";
import { useCommitImportJob, useCreateImportJob, useDeleteImportJob, useImportPreview, useUpdateMapping } from "../hooks";
import type { ImportJob, Mapping } from "../types";

export interface ImportWizardProps {
  kind: string; title: string; description: string; onCommitted?: (job: ImportJob) => void;
}
const sourceLabels = { preset: "알려진 형식", synonym: "자동 인식", llm: "AI 추천", user: "직접 지정" };

export function ImportWizard({ kind, title, description, onCommitted }: ImportWizardProps) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [step, setStep] = useState(1);
  const [message, setMessage] = useState("");
  const [skipInvalid, setSkipInvalid] = useState(true);
  const [page, setPage] = useState(1);
  const [onlyInvalid, setOnlyInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const create = useCreateImportJob(); const update = useUpdateMapping();
  const commit = useCommitImportJob(); const remove = useDeleteImportJob();
  const previewQuery = useImportPreview(step === 3 ? job?.id : undefined, page, onlyInvalid);
  const preview = previewQuery.data ?? (page === 1 && !onlyInvalid ? job?.preview : null);
  const busy = create.isPending || update.isPending || commit.isPending || remove.isPending;
  const queryExpired = isApiError(previewQuery.error) && previewQuery.error.status === 410;

  function failed(error: unknown) {
    setMessage(getErrorMessage(error));
    if (isApiError(error) && error.status === 410) { setJob(null); setFile(null); setStep(1); }
  }
  function accept(next: ImportJob) { setJob(next); setMapping(next.mapping); setMessage(""); }
  async function upload(selected: File, sheetName?: string) {
    setFile(selected); setMessage("");
    try {
      const next = await create.mutateAsync({ kind, file: selected, sheetName });
      accept(next); setStep(next.sheetNames.length > 1 ? 1 : 2);
    } catch (error) { failed(error); }
  }
  async function reset() {
    if (job && job.status !== "committed") {
      try { await remove.mutateAsync(job.id); } catch (error) {
        if (!isApiError(error) || ![404, 410].includes(error.status)) { failed(error); return; }
      }
    }
    setJob(null); setFile(null); setMapping({}); setStep(1); setMessage(""); setPage(1); setOnlyInvalid(false);
    if (input.current) input.current.value = "";
  }
  const complete = job?.fields.every((f) => !f.required || mapping[f.key] != null);
  const chosen = Object.values(mapping).filter((v) => v != null);
  const unique = new Set(chosen).size === chosen.length;

  return <Card className="w-full min-w-0 max-w-full overflow-hidden">
    <CardHeader><CardTitle className="break-words">{title}</CardTitle><p className="text-sm text-muted-foreground break-words">{description}</p><AiProviderBadge scope="personal" compact /></CardHeader>
    <CardContent className="min-w-0 space-y-5">
      <ol aria-label="가져오기 단계" className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{["파일 선택", "열 매핑", "미리보기", "결과"].map((label, i) => <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={step === i + 1 ? "font-semibold text-primary" : "text-muted-foreground"}>{i + 1}. {label}</li>)}</ol>
      {message && <p role="alert" className="break-words text-sm text-destructive">{message}</p>}
      {queryExpired ? <div role="alert" className="space-y-3"><p>업로드한 지 24시간이 지났습니다. 파일을 다시 올려 주세요.</p><Button onClick={() => { setJob(null); setFile(null); setStep(1); setMessage(""); }}>파일 다시 선택</Button></div> : <>
      {job?.warnings.map((w) => <p key={w} role="status" className="text-sm break-words">{w}</p>)}
      {busy && <p role="status" aria-live="polite">{create.isPending ? "파일을 읽고 열을 확인하고 있습니다…" : "처리하고 있습니다…"}</p>}
      {step === 1 && <div className="space-y-4">
        <div className="rounded-lg border-2 border-dashed p-5 text-center" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy && e.dataTransfer.files[0]) void upload(e.dataTransfer.files[0]); }}>
          <p className="mb-3 text-sm">파일을 여기로 끌어 놓거나 선택해 주세요.</p>
          <input ref={input} id="import-file" aria-label="가져올 파일" type="file" className="sr-only" accept=".csv,.xlsx,.xls,.html,.htm" disabled={busy} onChange={(e) => { if (e.target.files?.[0]) void upload(e.target.files[0]); }} />
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>파일 선택</Button>
          <p className="mt-3 text-xs text-muted-foreground">CSV, XLSX, XLS, HTML · 최대 5,000행</p>
        </div>
        {job && file && <div className="space-y-3"><p className="break-all text-sm">{job.fileName}</p><Label htmlFor="import-sheet">시트 선택</Label><Select value={job.sheetName ?? undefined} disabled={busy} onValueChange={(sheetName) => void upload(file, sheetName)}><SelectTrigger id="import-sheet" className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent>{job.sheetNames.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select><Button disabled={busy} onClick={() => setStep(2)}>열 매핑으로</Button></div>}
      </div>}
      {step === 2 && job && <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><Badge>{sourceLabels[job.mappingSource]}</Badge>{job.mappingSource === "llm" && <AiProviderBadge scope="personal" compact />}<span className="text-xs">제목 행 {job.headerRow} · 데이터 {job.rowCount}행 · 합계 제외 {job.skippedRowCount}행</span></div>
        <p className="text-sm">추천된 열과 예시 값을 확인한 뒤 확정해 주세요.</p>
        {job.fields.map((field) => {
          const selected = job.columns.find((c) => c.index === mapping[field.key]);
          return <div key={field.key} className="min-w-0 space-y-1.5"><Label htmlFor={`mapping-${field.key}`}>{field.label}{field.required && " (필수)"}</Label>
            <Select value={mapping[field.key] == null ? "none" : String(mapping[field.key])} disabled={busy} onValueChange={(value) => setMapping({ ...mapping, [field.key]: value === "none" ? null : Number(value) })}>
              <SelectTrigger id={`mapping-${field.key}`} className="w-full min-w-0"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">선택 안 함</SelectItem>{job.columns.map((column) => <SelectItem key={column.index} value={String(column.index)} disabled={Object.entries(mapping).some(([key, value]) => key !== field.key && value === column.index)}>{column.index + 1}. {column.header || "제목 없음"}</SelectItem>)}</SelectContent>
            </Select><p className="text-xs break-all text-muted-foreground">예시: {selected?.samples.join(" / ") || "—"}</p>
          </div>;
        })}
        {!unique && <p role="alert">한 열은 한 필드에만 쓸 수 있습니다.</p>}
        <Button disabled={busy || !complete || !unique} onClick={async () => { try { const next = await update.mutateAsync({ id: job.id, mapping }); accept(next); setPage(1); setOnlyInvalid(false); setStep(3); } catch (error) { failed(error); } }}>매핑 확정</Button>
        {job.mappingSource === "llm" && <Disclaimer variant="ai" />}
      </div>}
      {step === 3 && job && <div className="space-y-4">
        {previewQuery.isPending && !preview && <p role="status">미리보기를 불러오고 있습니다…</p>}
        {previewQuery.error && <p role="alert">{getErrorMessage(previewQuery.error)}</p>}
        {preview && <><p>정상 {preview.validCount}행 · 오류 {preview.invalidCount}행</p>
          <div className="flex items-center gap-2"><Checkbox id="import-only-invalid" checked={onlyInvalid} onCheckedChange={(v) => { setOnlyInvalid(v === true); setPage(1); }} /><Label htmlFor="import-only-invalid">오류 행만 보기</Label></div>
          <div className="space-y-3">{preview.rows.map((row) => <div key={row.rowNumber} className={`min-w-0 rounded-lg border p-3 ${row.errors.length ? "border-destructive bg-destructive/5" : ""}`}><p className="mb-2 text-sm font-semibold">원본 {row.rowNumber}행{row.errors.length ? " · 오류" : ""}</p><dl className="grid min-w-0 gap-1 text-sm">{job.fields.map((f) => <div key={f.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2"><dt className="break-words text-muted-foreground">{f.label}</dt><dd className="break-all">{String(row.values[f.key] ?? "—")}</dd></div>)}</dl>{row.errors.map((error, i) => <p key={i} className="mt-2 text-sm break-words text-destructive">{job.fields.find((f) => f.key === error.field)?.label}: {error.message}</p>)}</div>)}</div>
          <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page <= 1 || previewQuery.isFetching} onClick={() => setPage(page - 1)}>이전</Button><span className="text-sm">{page} / {Math.max(1, Math.ceil(preview.total / preview.pageSize))}</span><Button variant="outline" disabled={page * preview.pageSize >= preview.total || previewQuery.isFetching} onClick={() => setPage(page + 1)}>다음</Button></div>
          <div className="flex items-center gap-2"><Switch id="import-skip-invalid" checked={skipInvalid} disabled={busy} onCheckedChange={setSkipInvalid} /><Label htmlFor="import-skip-invalid">오류 행 제외하고 저장</Label></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => setStep(2)}>열 매핑 수정</Button><Button disabled={busy || !!previewQuery.error || previewQuery.isFetching || (!skipInvalid && preview.invalidCount > 0)} onClick={async () => { try { const next = await commit.mutateAsync({ id: job.id, skipInvalid }); accept(next); setStep(4); onCommitted?.(next); } catch (error) { failed(error); } }}>저장하기</Button></div>
        </>}
      </div>}
      {step === 4 && job?.result && <div className="space-y-3"><h3 className="font-semibold">가져오기를 마쳤습니다.</h3><p>저장 {job.result.inserted}건 · 중복 {job.result.skippedDuplicates}건 · 실패 {job.result.failed}건</p>{job.result.errors.map((e, i) => <p key={i} className="text-sm break-words text-destructive">원본 {e.rowNumber}행: {e.message}</p>)}</div>}
      {job && <Button variant="ghost" disabled={busy} onClick={() => void reset()}>{step === 4 ? "새 파일 가져오기" : "취소하고 다시 시작"}</Button>}
      </>}
    </CardContent>
  </Card>;
}
