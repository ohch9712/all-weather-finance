import { HttpResponse, http } from "msw";
import type { ChecklistItem, DashboardSummary } from "@/features/dashboard/types";
import { apiUrl, server } from "../utils";

export const CHECKLIST: ChecklistItem[] = [
  { key: "risk_assessment", label: "투자성향 진단하기", done: false, href: "/allocation/survey" },
  { key: "situation", label: "목표·상황 입력하기", done: false, href: "/allocation/situation" },
  { key: "holdings", label: "보유 자산 입력하기", done: false, href: "/allocation/assets" },
  { key: "ledger_entry", label: "가계부 첫 기록 남기기", done: false, href: "/ledger" },
  { key: "watchlist", label: "관심종목 담기", done: false, href: "/stocks/watchlist" },
];

export function checklist(doneKeys: ChecklistItem["key"][] | "all"): ChecklistItem[] {
  return CHECKLIST.map((item) => ({ ...item, done: doneKeys === "all" || doneKeys.includes(item.key) }));
}

/** 새로 가입한 사용자(모든 섹션 비어 있음) */
export function emptySummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    greetingName: "potato",
    allocation: {
      status: "needs_assessment",
      score: null,
      grade: null,
      scoreDelta: null,
      classes: null,
      topDirection: null,
    },
    ledger: { month: "2026-10", incomeTotal: 0, expenseTotal: 0, expenseChangeRate: null, topCategories: [] },
    journal: { monthRealizedPnl: [], winRate: null, openPositionCount: 0 },
    watchlist: { items: [], source: null },
    estate: { members: [] },
    learn: { today: null, readCount: 0, publishedCount: 35 },
    chat: { enabled: true, location: "local" },
    checklist: checklist([]),
    errors: [],
    ...overrides,
  };
}

/** 데이터가 채워진 사용자(스펙 16 3절 예시) */
export function fullSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    greetingName: "감자",
    allocation: {
      status: "ready",
      score: 80,
      grade: "A",
      scoreDelta: 3,
      classes: [
        { assetClass: "stock", actualWeight: 50.0, targetWeight: 32.5 },
        { assetClass: "bond", actualWeight: 20.0, targetWeight: 27.5 },
        { assetClass: "gold", actualWeight: 0.0, targetWeight: 5.0 },
        { assetClass: "cash", actualWeight: 30.0, targetWeight: 35.0 },
        { assetClass: "other", actualWeight: 0.0, targetWeight: 0.0 },
      ],
      topDirection: {
        kind: "reserve_short_term_goal",
        title: "'내 집 마련' 자금은 안전하게",
        body: "2028년 10월에 쓸 2,000만원은 예금처럼 원금이 지켜지는 곳에 두세요.",
        href: "/allocation/recommendation/detail",
      },
    },
    ledger: {
      month: "2026-10",
      incomeTotal: 3_500_000,
      expenseTotal: 1_820_000,
      expenseChangeRate: -9.45,
      topCategories: [
        { name: "식비", amount: 520_000, ratio: 28.57 },
        { name: "주거·관리비", amount: 400_000, ratio: 21.98 },
        { name: "교통", amount: 150_000, ratio: 8.24 },
      ],
    },
    journal: {
      monthRealizedPnl: [
        { currency: "KRW", realizedPnl: "74040" },
        { currency: "USD", realizedPnl: "-12.5" },
      ],
      winRate: 50.0,
      openPositionCount: 3,
    },
    watchlist: {
      items: [
        { code: "005930", name: "삼성전자", price: "71200", changeRate: -1.11 },
        { code: "000660", name: "SK하이닉스", price: "95700", changeRate: 2.5 },
        { code: "005380", name: "현대자동차", price: "46600", changeRate: 0 },
        { code: "000270", name: "기아", price: null, changeRate: null },
        { code: "035420", name: "NAVER", price: "293100", changeRate: -4.12 },
      ],
      source: "mock",
    },
    estate: {
      members: [
        { memberId: "m-1", displayName: "첫째", available: 20_000_000, nextResetOn: null },
        { memberId: "m-2", displayName: "둘째", available: 0, nextResetOn: "2034-02-02" },
      ],
    },
    learn: {
      today: {
        id: "p-1",
        kind: "glossary",
        slug: "per",
        title: "PER(주가수익비율)",
        summary: "주가를 주당순이익으로 나눈 값이에요.",
        term: "PER",
        level: "beginner",
        tags: ["지표"],
        videoId: null,
        aiAssisted: false,
        publishedAt: "2026-10-01T00:00:00Z",
        bookmarked: false,
        read: false,
      },
      readCount: 12,
      publishedCount: 35,
    },
    chat: { enabled: true, location: "local" },
    checklist: checklist("all"),
    errors: [],
    ...overrides,
  };
}

const AI_OFF = { enabled: false, provider: null, location: null, model: null, reason: "not_configured" };

/** 홈 요약과 AI 상태(AiProviderBadge)를 가짜로 둔다. 응답을 여러 개 주면 차례로 돌려준다. */
export function mockDashboard(...responses: (DashboardSummary | "error")[]) {
  const calls = { summary: 0 };
  server.use(
    http.get(apiUrl("/api/dashboard/summary"), () => {
      const response = responses[Math.min(calls.summary, responses.length - 1)];
      calls.summary += 1;
      if (response === "error") {
        return HttpResponse.json(
          { error: { code: "INTERNAL_ERROR", message: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", details: [] } },
          { status: 500 },
        );
      }
      return HttpResponse.json(response);
    }),
    http.get(apiUrl("/api/ai/status"), () =>
      HttpResponse.json({
        general: AI_OFF,
        personal: { enabled: true, provider: "ollama", location: "local", model: "가짜 모델", reason: null },
      }),
    ),
  );
  return calls;
}
