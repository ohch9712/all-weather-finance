"use client";
import { useState } from "react";
import { AiProviderBadge } from "@/components/common/AiProviderBadge";
import { Disclaimer } from "@/components/common/Disclaimer";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConnectorAccounts, useConnectorProviders } from "../hooks";
import { AccountCard } from "./AccountCard";
import { AccountForm } from "./AccountForm";

const mydataNote = "마이데이터는 금융위원회 허가를 받은 본인신용정보관리업자만 쓸 수 있어 개인 프로젝트에서는 연동할 수 없습니다.";
const environments = { sandbox: "샌드박스", development: "데모", production: "정식" };
export function DataConnectionsSection() {
  const [open, setOpen] = useState(false);
  const providers = useConnectorProviders();
  const accounts = useConnectorAccounts();
  const codef = providers.data?.items.find(item => item.key === "codef");
  const mydata = providers.data?.items.find(item => item.key === "mydata");
  return <section aria-labelledby="data-connections-heading" className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="data-connections-heading" className="text-xl font-semibold">데이터 자동 수집</h2><Button disabled={!codef?.available} onClick={() => setOpen(true)}>수집 계정 추가</Button></div>
    <Card><CardHeader><CardTitle>마이데이터 연동 안내</CardTitle></CardHeader><CardContent className="space-y-2 text-sm leading-relaxed"><p>{mydata?.note ?? mydataNote}</p><p className="text-muted-foreground">대신 CODEF로 카드 승인내역과 은행 잔액을 직접 가져올 수 있어요.</p></CardContent></Card>
    <Card><CardHeader><CardTitle>CODEF 연결 상태</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      {providers.isPending ? <LoadingState rows={1} /> : providers.error ? <ErrorState error={providers.error} onRetry={() => void providers.refetch()} /> : <><div className="flex flex-wrap gap-2"><Badge variant={codef?.available ? "outline" : "secondary"}>{codef?.available ? "사용 가능" : "키 설정 필요"}</Badge>{codef?.environment && <Badge variant="outline">{environments[codef.environment]}</Badge>}</div>{!codef?.available && <p>CODEF 키가 설정되지 않았습니다. 서버 관리자에게 키 설정을 요청해 주세요.</p>}<p>{codef?.note}</p></>}
      <p className="text-muted-foreground">가져오기 버튼을 누를 때만 수집해요. 카드 내역은 가계부에, 원화 예금 잔액은 자산배분의 현금성 자산에 반영합니다.</p>
      <div className="flex flex-wrap items-center gap-2"><span>가계부 자동 분류</span><AiProviderBadge scope="personal" /></div>
      <p className="text-muted-foreground">이 앱에는 연결 식별값만 암호화해 저장해요. 로그인 정보는 CODEF가 암호화해 보관하고, 연결을 삭제하면 함께 지워져요.</p>
    </CardContent></Card>
    {codef?.environment === "sandbox" && <Disclaimer variant="sample" />}
    {accounts.isPending ? <LoadingState /> : accounts.error ? <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} /> : !accounts.data?.items.length ? <EmptyState title="연결한 수집 계정이 없어요" description="지원하는 카드사나 은행 계정을 연결해 보세요." /> : <div className="grid min-w-0 gap-4 lg:grid-cols-2">{accounts.data.items.map(account => <AccountCard key={account.id} account={account} available={!!codef?.available} />)}</div>}
    <Disclaimer variant="investment" /><Disclaimer variant="ai" />
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>수집 계정 추가</DialogTitle><DialogDescription>아이디 로그인으로 조회할 카드사나 은행을 선택하세요.</DialogDescription></DialogHeader>{open && <AccountForm onSaved={() => setOpen(false)} />}</DialogContent></Dialog>
  </section>;
}
