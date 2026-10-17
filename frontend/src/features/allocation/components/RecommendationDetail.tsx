"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { Disclaimer } from "@/components/common/Disclaimer";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { MoneyText } from "@/components/common/MoneyText";
import { PageHeader } from "@/components/common/PageHeader";
import { assetColor } from "@/components/charts/palette";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AGE_BAND_LABEL, ASSET_CLASSES, ASSET_CLASS_LABEL, RISK_PROFILE_LABEL } from "@/lib/domain";
import { formatDate, formatKRWCompact, formatPercent } from "@/lib/format";
import { ALLOCATION_PATHS, HORIZON_LABEL } from "../constants";
import { formatYearMonth } from "../dates";
import { useGoals, useProfileSummary, useRecommendation, useSituation } from "../hooks";
import type { ByAssetClass, Goal, ProfileSummary, Recommendation, Situation } from "../types";
import { DirectionCard } from "./RecommendationView";
import { StatusNotice } from "./StatusNotice";
import { TargetTableDialog } from "./TargetTableDialog";

/** 9.6 상세 설명 */
export function RecommendationDetail() {
  const recommendation = useRecommendation();
  const profile = useProfileSummary();
  const situation = useSituation();
  const goals = useGoals();
  const queries = [recommendation, profile, situation, goals];
  const failed = queries.find((query) => query.isError);

  function content() {
    if (failed) return <ErrorState error={failed.error} onRetry={() => queries.forEach((query) => query.refetch())} />;
    if (!recommendation.data || !profile.data || situation.data === undefined || !goals.data) {
      return <LoadingState rows={6} />;
    }
    if (recommendation.data.status !== "ready") return <StatusNotice status={recommendation.data.status} />;
    return (
      <DetailBody
        recommendation={recommendation.data}
        profile={profile.data}
        situation={situation.data}
        goals={goals.data}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="왜 이렇게 추천했나요?" description="권장 배분이 만들어진 순서와 이유를 하나씩 보여 드려요." />
      {content()}
      <Disclaimer variant="investment" />
    </div>
  );
}

function Section({ step, title, description, children }: { step: number; title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>
            <span className="text-muted-foreground tabular-nums">{step}.</span> {title}
          </h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EditLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="shrink-0">
      <Link href={href} aria-label={`${label} 수정`}>
        <Pencil aria-hidden="true" />
        수정
      </Link>
    </Button>
  );
}

function InfoRow({ label, href, children }: { label: string; href: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm break-keep wrap-anywhere">{children}</dd>
      </div>
      <EditLink href={href} label={label} />
    </div>
  );
}

/** 장기 투자 층만의 자산군별 금액 = 권장 금액 − 비상금·가까운 목표 층 */
function longTermSplit(recommendation: Recommendation): ByAssetClass<number> | null {
  const { targetAmounts, layers } = recommendation;
  if (!targetAmounts || !layers) return null;
  const split = { ...targetAmounts };
  split.cash -= layers.emergency?.allocatedAmount ?? 0;
  for (const goal of layers.shortTermGoals) split[goal.assetClass] -= goal.allocatedAmount ?? 0;
  return split;
}

function DetailBody({
  recommendation,
  profile,
  situation,
  goals,
}: {
  recommendation: Recommendation;
  profile: ProfileSummary;
  situation: Situation | null;
  goals: Goal[];
}) {
  const { ageBand, riskProfile, riskScore, risky, layers, baseWeights, layering } = recommendation;
  const applied = layering === "applied";
  const split = longTermSplit(recommendation);
  const emergency = layers?.emergency ?? null;
  const shortTermGoals = layers?.shortTermGoals ?? [];

  return (
    <>
      <Section step={1} title="내 정보">
        <dl>
          <InfoRow label="나이대" href="/settings/profile">
            {ageBand ? AGE_BAND_LABEL[ageBand] : "-"}
            {profile.birthYear !== null && <span className="text-muted-foreground"> ({profile.birthYear}년생)</span>}
          </InfoRow>
          <InfoRow label="투자성향" href={ALLOCATION_PATHS.survey}>
            {riskProfile ? RISK_PROFILE_LABEL[riskProfile] : "-"} · {riskScore?.toFixed(1)}점
          </InfoRow>
          <InfoRow label="상황" href={ALLOCATION_PATHS.situation}>
            {situation ? (
              <>
                생활비 {formatKRWCompact(situation.monthlyExpense)} · 부양가족 {situation.dependents}명 · 고금리 대출{" "}
                {formatKRWCompact(situation.consumerDebt)}
              </>
            ) : (
              <span className="text-muted-foreground">입력하지 않았어요</span>
            )}
          </InfoRow>
          <InfoRow label="목표" href={ALLOCATION_PATHS.situation}>
            {goals.length === 0 ? (
              <span className="text-muted-foreground">입력하지 않았어요</span>
            ) : (
              <ul className="space-y-0.5">
                {goals.map((goal) => (
                  <li key={goal.id}>
                    {goal.title} {formatKRWCompact(goal.targetAmount)} · {formatDate(goal.targetDate)}{" "}
                    <span className="text-muted-foreground">({HORIZON_LABEL[goal.horizon]})</span>
                  </li>
                ))}
              </ul>
            )}
          </InfoRow>
        </dl>
      </Section>

      <Section
        step={2}
        title="권장 배분이 만들어진 순서"
        description={
          applied
            ? `배분 대상 자산 ${formatKRWCompact(recommendation.totalAmount ?? 0)}을 아래 순서로 나눴어요.`
            : "자산을 입력하면 아래 순서로 금액을 나눠요."
        }
      >
        <ol aria-label="층 순서" className="space-y-4">
          <li>
            <p className="font-medium">① 비상금 → 현금성 자산</p>
            <p className="text-sm text-muted-foreground break-keep">
              {emergency
                ? `생활비 ${formatKRWCompact(emergency.monthlyExpense)}의 ${emergency.months}개월치(${formatKRWCompact(emergency.targetAmount)})` +
                  (emergency.allocatedAmount !== null ? ` 중 ${formatKRWCompact(emergency.allocatedAmount)}을 먼저 떼어 두었어요.` : "를 먼저 떼어 둬요.")
                : "상황(월 생활비)을 입력하지 않아 건너뛰었어요."}
            </p>
          </li>
          <li>
            <p className="font-medium">② 3년 안에 쓸 목표 자금 → 현금성 자산·채권</p>
            {shortTermGoals.length === 0 ? (
              <p className="text-sm text-muted-foreground">3년 안에 쓸 목표가 없어요.</p>
            ) : (
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {shortTermGoals.map((goal) => (
                  <li key={goal.goalId} className="break-keep wrap-anywhere">
                    &apos;{goal.title}&apos; {formatYearMonth(goal.targetDate)}{" "}
                    {formatKRWCompact(goal.allocatedAmount ?? goal.targetAmount)} → {ASSET_CLASS_LABEL[goal.assetClass]}
                  </li>
                ))}
              </ul>
            )}
          </li>
          <li>
            <p className="font-medium">③ 나머지 → 장기 투자(나이대·성향 표 비중)</p>
            {baseWeights && (
              <p className="text-sm text-muted-foreground break-keep">
                {ASSET_CLASSES.map((assetClass) => `${ASSET_CLASS_LABEL[assetClass]} ${baseWeights[assetClass]}%`).join(" · ")}
              </p>
            )}
            {applied && split && (
              <>
                <p className="mt-2 text-sm">
                  장기 투자 몫 <MoneyText value={layers?.longTermAmount ?? 0} compact className="font-medium" />을 나눈 결과
                </p>
                <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  {ASSET_CLASSES.map((assetClass) => (
                    <li key={assetClass} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="inline-block size-2.5 rounded-[3px]"
                          style={{ background: assetColor(assetClass) }}
                        />
                        {ASSET_CLASS_LABEL[assetClass]}
                      </span>
                      <MoneyText value={split[assetClass]} compact />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </li>
        </ol>
      </Section>

      {risky && (
        <Section step={3} title="위험자산 비중 계산" description="위험자산은 주식과 기타 자산이에요.">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">출발점</dt>
              <dd className="font-medium tabular-nums">
                100 − {100 - risky.start} = {risky.start}%
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">성향 보정</dt>
              <dd className="font-medium tabular-nums">
                {risky.adjustment > 0 ? `+${risky.adjustment}` : risky.adjustment}%p
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">10~90% 제한</dt>
              <dd className="font-medium">{risky.clamped ? "적용됨" : "해당 없음"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">최종 위험자산 비중</dt>
              <dd className="font-medium tabular-nums">{risky.final}%</dd>
            </div>
          </dl>
        </Section>
      )}

      <Section step={4} title="내 답변과 성향 점수">
        <ul className="space-y-4">
          {recommendation.answerContributions.map((item) => (
            <li key={item.questionId} className="space-y-1.5">
              <p className="text-sm font-medium break-keep">{item.question}</p>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground break-keep">{item.answerLabel}</span>
                <span className="shrink-0 tabular-nums">
                  {item.points.toFixed(1)} / {item.maxPoints.toFixed(1)}점
                </span>
              </div>
              <Progress
                value={item.maxPoints > 0 ? (item.points / item.maxPoints) * 100 : 0}
                aria-label={`${item.question} ${item.points.toFixed(1)}점`}
              />
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-baseline justify-between border-t pt-3 font-medium">
          <span>합계(진단 점수)</span>
          <span className="tabular-nums">{riskScore?.toFixed(1)}점</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">문항별 점수는 반올림해서 합이 0.1점 다를 수 있어요.</p>
      </Section>

      <Section step={5} title="추천 이유">
        <ul className="space-y-4">
          {recommendation.reasons.map((reason) => (
            <li key={reason.code}>
              <p className="font-medium break-keep wrap-anywhere">{reason.title}</p>
              <p className="text-sm text-muted-foreground break-keep wrap-anywhere">{reason.body}</p>
            </li>
          ))}
        </ul>
        <h3 className="mt-6 mb-3 text-sm font-medium">자산군별 역할</h3>
        <ul className="space-y-3">
          {recommendation.assetClassNotes.map((note) => (
            <li key={note.assetClass} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-1.5 inline-block size-2.5 shrink-0 rounded-[3px]"
                style={{ background: assetColor(note.assetClass) }}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {ASSET_CLASS_LABEL[note.assetClass]}{" "}
                  <span className="text-muted-foreground tabular-nums">권장 {formatPercent(note.weight, 1)}</span>
                </p>
                <p className="text-sm text-muted-foreground break-keep">{note.note}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section step={6} title="관리 방향">
        <ol aria-label="관리 방향 전체" className="space-y-3">
          {recommendation.directions.map((direction, index) => (
            <DirectionCard key={`${direction.kind}-${index}`} direction={direction} />
          ))}
        </ol>
      </Section>

      <div>
        <TargetTableDialog ageBand={ageBand} riskProfile={riskProfile} />
      </div>
    </>
  );
}
