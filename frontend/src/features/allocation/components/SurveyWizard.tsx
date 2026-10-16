"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ALLOCATION_PATHS, ONBOARDING_QUERY } from "../constants";
import { useCreateRiskAssessment, useLatestAssessment, useSurvey } from "../hooks";
import type { Survey, SurveyAnswers } from "../types";
import { OnboardingProgress, useIsOnboarding } from "./OnboardingProgress";

/** 9.1 투자성향 설문: 한 화면에 한 문항, 이전·다음, 마지막에 "결과 보기" */
export function SurveyWizard() {
  const onboarding = useIsOnboarding();
  const survey = useSurvey();
  const latest = useLatestAssessment();

  return (
    <div className="mx-auto max-w-xl">
      {onboarding && <OnboardingProgress step={1} />}
      <PageHeader
        title="투자성향 진단"
        description="6개 질문에 답하면 투자성향을 알려 드려요. 나이는 나이대로 따로 반영해요."
      />
      {survey.isPending || latest.isPending ? (
        <LoadingState rows={4} />
      ) : survey.isError ? (
        <ErrorState error={survey.error} onRetry={() => survey.refetch()} />
      ) : (
        <SurveySteps
          survey={survey.data}
          // 다시 진단할 때는 지난 답을 미리 골라 둔다(같은 문항일 때만).
          initialAnswers={latest.data?.answers ?? {}}
          onboarding={onboarding}
        />
      )}
    </div>
  );
}

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.code === "VALIDATION_ERROR" && error.details.length > 0) {
    return error.details[0].message;
  }
  return getErrorMessage(error);
}

function SurveySteps({
  survey,
  initialAnswers,
  onboarding,
}: {
  survey: Survey;
  initialAnswers: SurveyAnswers;
  onboarding: boolean;
}) {
  const router = useRouter();
  const createAssessment = useCreateRiskAssessment();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<SurveyAnswers>(() =>
    Object.fromEntries(
      survey.questions.flatMap((question) => {
        const value = initialAnswers[question.id];
        return question.options.some((option) => option.value === value) ? [[question.id, value]] : [];
      }),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const total = survey.questions.length;
  const question = survey.questions[index];
  const selected = answers[question.id];
  const isLast = index === total - 1;
  const submitting = createAssessment.isPending;

  async function submit() {
    setError(null);
    try {
      await createAssessment.mutateAsync({ surveyVersion: survey.version, answers });
      router.push(onboarding ? `${ALLOCATION_PATHS.situation}${ONBOARDING_QUERY}` : ALLOCATION_PATHS.recommendation);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            질문 <span className="tabular-nums">{index + 1}/{total}</span>
          </p>
          <Progress value={((index + 1) / total) * 100} aria-label={`진행률 ${index + 1}/${total}`} />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <fieldset className="space-y-3">
          <legend className="mb-3 text-lg font-semibold break-keep">
            <h2 id={`question-${question.id}`}>{question.text}</h2>
          </legend>
          <RadioGroup
            key={question.id}
            aria-labelledby={`question-${question.id}`}
            value={selected === undefined ? "" : String(selected)}
            onValueChange={(value) => setAnswers((current) => ({ ...current, [question.id]: Number(value) }))}
            className="gap-2"
          >
            {question.options.map((option) => {
              const id = `${question.id}-${option.value}`;
              const checked = selected === option.value;
              return (
                <Label
                  key={option.value}
                  htmlFor={id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 font-normal break-keep transition-colors hover:bg-muted",
                    checked && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem id={id} value={String(option.value)} />
                  {option.label}
                </Label>
              );
            })}
          </RadioGroup>
        </fieldset>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={index === 0 || submitting}
            onClick={() => setIndex((current) => current - 1)}
          >
            <ChevronLeft aria-hidden="true" />
            이전
          </Button>
          {isLast ? (
            <Button type="button" size="lg" disabled={selected === undefined || submitting} onClick={submit}>
              {submitting ? "저장 중…" : "결과 보기"}
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              disabled={selected === undefined}
              onClick={() => setIndex((current) => current + 1)}
            >
              다음
              <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
