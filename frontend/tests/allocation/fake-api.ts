import { HttpResponse, http } from "msw";
import type {
  AllocationReport,
  Goal,
  GoalInput,
  Holding,
  HoldingInput,
  Recommendation,
  RiskAssessment,
  ScoreItem,
  Situation,
  SituationInput,
} from "@/features/allocation/types";
import { apiUrl, errorResponse, server, testProfile } from "../utils";
import { RECOMMENDATION_APPLIED, SURVEY, TARGET_TABLE } from "./responses";

// 자산배분 API의 메모리 가짜(MSW). 테스트마다 installFakeAllocationApi()로 새 상태를 만든다.

export const REPORT_READY: AllocationReport = {
  status: "ready",
  ageBand: "30s",
  riskProfile: "neutral",
  totalAmount: 52_000_000,
  excludedAmount: 300_000_000,
  score: 58,
  grade: "D",
  scoreDelta: 3,
  scoredOn: "2026-10-16",
  classes: [
    { assetClass: "stock", actualAmount: 26_000_000, actualWeight: 50.0, targetWeight: 32.5, targetAmount: 16_900_000, diffAmount: -9_100_000 },
    { assetClass: "bond", actualAmount: 6_000_000, actualWeight: 11.54, targetWeight: 50.96, targetAmount: 26_500_000, diffAmount: 20_500_000 },
    { assetClass: "gold", actualAmount: 0, actualWeight: 0.0, targetWeight: 2.5, targetAmount: 1_300_000, diffAmount: 1_300_000 },
    { assetClass: "cash", actualAmount: 20_000_000, actualWeight: 38.46, targetWeight: 14.04, targetAmount: 7_300_000, diffAmount: -12_700_000 },
    { assetClass: "other", actualAmount: 0, actualWeight: 0.0, targetWeight: 0.0, targetAmount: 0, diffAmount: 0 },
  ],
};

export function emptyReport(status: AllocationReport["status"]): AllocationReport {
  return {
    status,
    ageBand: status === "needs_profile" ? null : "30s",
    riskProfile: status === "needs_holdings" ? "neutral" : null,
    totalAmount: 0,
    excludedAmount: 0,
    score: null,
    grade: null,
    scoreDelta: null,
    scoredOn: null,
    classes: null,
  };
}

export function holding(overrides: Partial<Holding> & Pick<Holding, "id" | "name" | "assetClass" | "amount">): Holding {
  return {
    includeInAllocation: true,
    source: "manual",
    connectionId: null,
    syncedAt: null,
    classOverride: false,
    memo: null,
    createdAt: "2026-10-16T03:00:00Z",
    updatedAt: "2026-10-16T03:00:00Z",
    ...overrides,
  };
}

export function goal(overrides: Partial<Goal> & Pick<Goal, "id">): Goal {
  return {
    goalType: "home",
    title: "내 집 마련",
    targetAmount: 20_000_000,
    targetDate: "2028-10-16",
    horizon: "within_3y",
    createdAt: "2026-10-16T03:00:00Z",
    updatedAt: "2026-10-16T03:00:00Z",
    ...overrides,
  };
}

export const LATEST_ASSESSMENT: RiskAssessment = {
  id: "00000000-0000-4000-8000-000000000201",
  score: 57.8,
  riskProfile: "neutral",
  answers: { horizon: 3, experience: 4, knowledge: 3, income: 3, investmentRatio: 3, lossTolerance: 3 },
  createdAt: "2026-10-16T03:00:00Z",
};

export interface FakeState {
  holdings: Holding[];
  goals: Goal[];
  situation: Situation | null;
  recommendation: Recommendation;
  report: AllocationReport;
  scores: ScoreItem[];
  latestAssessment: RiskAssessment | null;
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

let sequence = 0;
function nextId(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function emergencyMonths(dependents: number): number {
  return dependents >= 1 ? 6 : 3;
}

const BASE = "/api/allocation";

export function installFakeAllocationApi(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    holdings: [],
    goals: [],
    situation: null,
    recommendation: RECOMMENDATION_APPLIED,
    report: REPORT_READY,
    scores: [],
    latestAssessment: null,
    ...initial,
  };
  const calls: RecordedCall[] = [];

  async function record(request: Request): Promise<unknown> {
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method: request.method, path: `${url.pathname}${url.search}`, body });
    return body;
  }

  server.use(
    http.get(apiUrl("/api/profile"), async ({ request }) => {
      await record(request);
      return HttpResponse.json(testProfile);
    }),
    http.get(apiUrl(`${BASE}/survey`), async ({ request }) => {
      await record(request);
      return HttpResponse.json(SURVEY);
    }),
    http.get(apiUrl(`${BASE}/risk-assessments/latest`), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ assessment: state.latestAssessment });
    }),
    http.post(apiUrl(`${BASE}/risk-assessments`), async ({ request }) => {
      await record(request);
      return HttpResponse.json(
        { id: nextId(), score: 57.8, riskProfile: "neutral", createdAt: "2026-10-16T03:00:00Z" },
        { status: 201 },
      );
    }),
    http.get(apiUrl(`${BASE}/targets/table`), async ({ request }) => {
      await record(request);
      return HttpResponse.json(TARGET_TABLE);
    }),
    http.get(apiUrl(`${BASE}/recommendation`), async ({ request }) => {
      await record(request);
      return HttpResponse.json(state.recommendation);
    }),
    http.get(apiUrl(`${BASE}/report`), async ({ request }) => {
      await record(request);
      return HttpResponse.json(state.report);
    }),
    http.get(apiUrl(`${BASE}/scores`), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ items: state.scores });
    }),
    http.get(apiUrl(`${BASE}/holdings`), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ items: state.holdings });
    }),
    http.post(apiUrl(`${BASE}/holdings`), async ({ request }) => {
      const body = (await record(request)) as HoldingInput;
      const created = holding({ id: nextId(), ...body });
      state.holdings = [...state.holdings, created];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.post(apiUrl(`${BASE}/holdings/bulk`), async ({ request }) => {
      const body = (await record(request)) as { items: HoldingInput[] };
      const created = body.items.map((item) => holding({ id: nextId(), ...item }));
      state.holdings = [...state.holdings, ...created];
      return HttpResponse.json({ items: created }, { status: 201 });
    }),
    http.patch(apiUrl(`${BASE}/holdings/:id`), async ({ request, params }) => {
      const body = (await record(request)) as Partial<HoldingInput>;
      const found = state.holdings.find((item) => item.id === params.id);
      if (!found) return errorResponse(404, "NOT_FOUND", "보유 자산을 찾을 수 없습니다.");
      const updated = { ...found, ...body };
      state.holdings = state.holdings.map((item) => (item.id === found.id ? updated : item));
      return HttpResponse.json(updated);
    }),
    http.delete(apiUrl(`${BASE}/holdings/:id`), async ({ request, params }) => {
      await record(request);
      state.holdings = state.holdings.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(apiUrl(`${BASE}/situation`), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ situation: state.situation });
    }),
    http.put(apiUrl(`${BASE}/situation`), async ({ request }) => {
      const body = (await record(request)) as SituationInput;
      const months = emergencyMonths(body.dependents);
      state.situation = {
        ...body,
        emergencyMonths: months,
        emergencyTarget: body.monthlyExpense * months,
        updatedAt: "2026-10-16T03:00:00Z",
      };
      return HttpResponse.json(state.situation);
    }),
    http.get(apiUrl(`${BASE}/goals`), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ items: state.goals });
    }),
    http.post(apiUrl(`${BASE}/goals`), async ({ request }) => {
      const body = (await record(request)) as GoalInput;
      const created = goal({ id: nextId(), ...body, title: body.title || "내 집 마련" });
      state.goals = [...state.goals, created];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch(apiUrl(`${BASE}/goals/:id`), async ({ request, params }) => {
      const body = (await record(request)) as Partial<GoalInput>;
      const found = state.goals.find((item) => item.id === params.id);
      if (!found) return errorResponse(404, "NOT_FOUND", "목표를 찾을 수 없습니다.");
      const updated = { ...found, ...body };
      state.goals = state.goals.map((item) => (item.id === found.id ? updated : item));
      return HttpResponse.json(updated);
    }),
    http.delete(apiUrl(`${BASE}/goals/:id`), async ({ request, params }) => {
      await record(request);
      state.goals = state.goals.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );

  return {
    state,
    calls,
    /** 쓰기 요청만(GET 제외) */
    writes: () => calls.filter((call) => call.method !== "GET"),
    count: (method: string, path: string) => calls.filter((call) => call.method === method && call.path === path).length,
  };
}
