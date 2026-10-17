"use client";

import Link from "next/link";
import { ArrowRight, PartyPopper } from "lucide-react";
import { Disclaimer } from "@/components/common/Disclaimer";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { MoneyText } from "@/components/common/MoneyText";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AGE_BAND_LABEL, RISK_PROFILE_LABEL } from "@/lib/domain";
import { ALLOCATION_PATHS } from "../constants";
import { useRecommendation } from "../hooks";
import type { Direction, Recommendation } from "../types";
import { AllocationDonut } from "./AllocationDonut";
import { LayerSummary } from "./LayerSummary";
import { useIsOnboarding } from "./OnboardingProgress";
import { StatusNotice } from "./StatusNotice";

/** 방향 버튼 문구(href별) */
const DIRECTION_ACTION: Record<string, string> = {
  [ALLOCATION_PATHS.situation]: "상황 입력하기",
  [ALLOCATION_PATHS.assets]: "자산 관리하기",
  [ALLOCATION_PATHS.detail]: "자세히 보기",
  [ALLOCATION_PATHS.report]: "리포트 보기",
};

/** 본문 첫 문장. 숫자 속 마침표(57.8)는 문장 끝으로 보지 않는다. */
export function firstSentence(text: string): string {
  const match = /^(.+?[.!?])(?=\s|$)/.exec(text);
  return match ? match[1] : text;
}

export function DirectionCard({ direction }: { direction: Direction }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 font-semibold break-keep wrap-anywhere">{direction.title}</h3>
        {direction.amount !== null && <MoneyText value={direction.amount} compact className="text-sm font-medium" />}
      </div>
      <p className="text-sm text-muted-foreground break-keep wrap-anywhere">{direction.body}</p>
      <div>
        <Button asChild variant="link" className="h-auto px-0">
          <Link href={direction.href}>
            {DIRECTION_ACTION[direction.href] ?? "바로 가기"}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </li>
  );
}

/** 9.5 추천 결과 */
export function RecommendationView() {
  const onboarding = useIsOnboarding();
  const query = useRecommendation();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="내 추천 결과" description="나이대·투자성향·상황·목표를 반영한 권장 자산배분이에요." />
      {onboarding && (
        <Alert>
          <PartyPopper aria-hidden="true" />
          <AlertTitle>설정을 마쳤어요. 이렇게 관리해 보세요.</AlertTitle>
          <AlertDescription>
            <Link href="/" className="underline underline-offset-4">
              홈으로
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {query.isPending ? (
        <LoadingState rows={5} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.status !== "ready" ? (
        <StatusNotice status={query.data.status} />
      ) : (
        <RecommendationBody recommendation={query.data} />
      )}
      <Disclaimer variant="investment" />
    </div>
  );
}

function RecommendationBody({ recommendation }: { recommendation: Recommendation }) {
  const { ageBand, riskProfile, riskScore, layers, layering, targetWeights, targetAmounts } = recommendation;
  const applied = layering === "applied";
  const hasHoldings = (recommendation.totalAmount ?? 0) > 0;

  return (
    <>
      <ul aria-label="내 정보 요약" className="flex flex-wrap gap-2">
        {ageBand && (
          <li>
            <Badge variant="secondary">{AGE_BAND_LABEL[ageBand]}</Badge>
          </li>
        )}
        {riskProfile && (
          <li>
            <Badge variant="secondary">
              {RISK_PROFILE_LABEL[riskProfile]}({riskScore?.toFixed(1)}점)
            </Badge>
          </li>
        )}
        {layers?.emergency && (
          <li>
            <Badge variant="secondary">비상금 {layers.emergency.months}개월</Badge>
          </li>
        )}
      </ul>
      {recommendation.riskProfileSummary && (
        <p className="-mt-3 text-sm text-muted-foreground">{recommendation.riskProfileSummary}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>목표 반영 권장 배분</h2>
          </CardTitle>
          <CardDescription>비상금 → 3년 안 목표 자금 → 장기 투자 순서로 나눴어요.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2 md:items-center">
          {targetWeights && (
            <AllocationDonut
              values={applied && targetAmounts ? targetAmounts : targetWeights}
              unit={applied && targetAmounts ? "amount" : "percent"}
              legendAmounts={applied ? targetAmounts : null}
              ariaLabel="목표 반영 권장 배분"
              centerLabel={
                applied && recommendation.totalAmount !== null ? (
                  <span className="flex flex-col">
                    <span className="text-xs text-muted-foreground">배분 대상</span>
                    <MoneyText value={recommendation.totalAmount} compact className="font-semibold" />
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">권장 비중</span>
                )
              }
            />
          )}
          {applied && layers ? (
            <LayerSummary layers={layers} />
          ) : (
            <p className="rounded-lg bg-muted px-4 py-3 text-sm break-keep">
              자산을 입력하면 비상금과 목표 자금을 반영해요. 지금은 나이대·성향 표의 비중이에요.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>먼저 할 일</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {recommendation.directions.slice(0, 3).map((direction, index) => (
              <DirectionCard key={`${direction.kind}-${index}`} direction={direction} />
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>추천 이유</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {recommendation.reasons.slice(0, 3).map((reason) => (
              <li key={reason.code}>
                <p className="font-medium break-keep wrap-anywhere">{reason.title}</p>
                <p className="text-sm text-muted-foreground break-keep wrap-anywhere">{firstSentence(reason.body)}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild size="lg">
          <Link href={ALLOCATION_PATHS.detail}>왜 이렇게 추천했는지 자세히 보기</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          {hasHoldings ? (
            <Link href={ALLOCATION_PATHS.report}>자산배분 리포트 보기</Link>
          ) : (
            <Link href={ALLOCATION_PATHS.assets}>보유 자산 입력하기</Link>
          )}
        </Button>
      </div>
    </>
  );
}
