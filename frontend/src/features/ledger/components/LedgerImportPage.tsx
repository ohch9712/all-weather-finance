"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImportWizard, type ImportJob } from "@/features/imports";
import { AiProviderBadge } from "@/components/common/AiProviderBadge";
import { Disclaimer } from "@/components/common/Disclaimer";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAiStatus } from "@/lib/ai-status";
import { getErrorMessage } from "@/lib/api-client";
import { useExtractStatement } from "../hooks";
import { ExtractedStatementWizard } from "./ExtractedStatementWizard";

export function LedgerImportPage() {
  const router = useRouter();
  const status = useAiStatus();
  const personal = status.data?.personal;
  const extract = useExtractStatement();
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const onCommitted = (next: ImportJob) => router.push(`/ledger/import/review?batch=${next.id}`);

  return <div className="min-w-0 space-y-6">
    <PageHeader title="카드 명세서 가져오기" description="이용내역을 확인한 뒤 가계부에 저장하세요." />
    <Tabs defaultValue="table" className="min-w-0">
      <TabsList className="h-auto w-full flex-wrap"><TabsTrigger value="table" className="whitespace-normal">엑셀·CSV 파일</TabsTrigger><TabsTrigger value="ai" className="whitespace-normal">PDF·이미지 명세서(AI)</TabsTrigger></TabsList>
      <TabsContent value="table" className="min-w-0 space-y-4">
        <p className="text-sm">카드사 홈페이지 → 이용내역 조회 → 엑셀 저장 순서로 내려받으세요. 암호 없는 파일을 올려 주세요.</p>
        <ImportWizard kind="ledger_card" title="카드 이용내역 파일" description="이용일·가맹점·금액 열을 확인하고 가져옵니다." onCommitted={onCommitted} />
      </TabsContent>
      <TabsContent value="ai" className="min-w-0 space-y-4">
        <AiProviderBadge scope="personal" />
        {status.isPending && <p role="status">AI 처리 위치를 확인하고 있습니다…</p>}
        {status.error && <p role="alert">{getErrorMessage(status.error)}</p>}
        {personal && !personal.enabled && <p role="status">AI 명세서 추출이 꺼져 있습니다. 서버에 개인 데이터용 AI를 설정한 뒤 이용해 주세요. 엑셀·CSV 파일은 지금 가져올 수 있습니다.</p>}
        {personal?.enabled && <>
          <p className="text-sm">{personal.provider === "ollama" ? "명세서는 이 서버의 로컬 AI(Ollama)가 처리하고 외부로 보내지 않아요. 몇 분 걸릴 수 있어요." : "명세서 내용이 Google Gemini로 전송돼요."}</p>
          {job ? <ExtractedStatementWizard key={job.id} initialJob={job} onCommitted={onCommitted} onReset={() => { setJob(null); setFile(null); setConsent(false); }} /> : <div className="space-y-4 rounded-lg border p-4">
            <Label htmlFor="statement-file">명세서 파일</Label>
            <Input id="statement-file" type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={extract.isPending} className="min-w-0 max-w-full" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setConsent(false); extract.reset(); }} />
            <p className="text-xs text-muted-foreground">PDF 10MB·20쪽 이하 / PNG·JPEG 5MB 이하</p>
            <div className="flex items-start gap-2"><Checkbox id="statement-consent" checked={consent} disabled={extract.isPending} onCheckedChange={(checked) => setConsent(checked === true)} /><Label htmlFor="statement-consent" className="leading-5">AI로 명세서를 처리하는 데 동의합니다</Label></div>
            {extract.error && <p role="alert">{getErrorMessage(extract.error)}</p>}
            {extract.isPending && <p role="status" aria-live="polite">AI가 명세서에서 거래를 추출하고 있습니다. 잠시 기다려 주세요…</p>}
            <Button disabled={!file || !consent || extract.isPending} onClick={async () => { if (file) { try { setJob(await extract.mutateAsync({ file, consent })); } catch { /* 오류는 위에서 표시한다. */ } } }}>명세서 추출하기</Button>
          </div>}
        </>}
        <Disclaimer variant="ai" />
      </TabsContent>
    </Tabs>
  </div>;
}
