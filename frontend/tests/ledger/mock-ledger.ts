import { HttpResponse, http } from "msw";
import type {
  Category,
  CategoryAmount,
  DailyAmount,
  Entry,
  EntryInput,
  EntryKind,
  MonthlySummary,
} from "@/features/ledger/types";
import { apiUrl, errorResponse, server } from "../utils";

// 가계부 API(스펙 03 5절)를 메모리에서 흉내 낸다. 요청은 `requests`에 "METHOD /path?query"로 남는다.

const EXPENSE = ["식비", "카페·간식", "교통", "주거·관리비", "쇼핑", "기타 지출"];
const INCOME = ["급여", "상여", "기타 수입"];

export function defaultCategories(): Category[] {
  return [
    ...EXPENSE.map((name, index) => ({ id: `cat-e${index + 1}`, kind: "expense" as const, name, isDefault: true, sortOrder: index + 1 })),
    ...INCOME.map((name, index) => ({ id: `cat-i${index + 1}`, kind: "income" as const, name, isDefault: true, sortOrder: index + 1 })),
  ];
}

export interface SeedEntry {
  kind?: EntryKind;
  occurredOn: string;
  amount: number;
  category: string;
  merchant?: string | null;
  memo?: string | null;
  source?: Entry["source"];
}

export interface MockLedger {
  categories: Category[];
  entries: Entry[];
  requests: string[];
  bodies: { method: string; path: string; body: unknown }[];
}

let sequence = 0;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function shift(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + number - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function totals(entries: Entry[], month: string) {
  const inMonth = entries.filter((entry) => entry.occurredOn.startsWith(month));
  const sum = (kind: EntryKind) => inMonth.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.amount, 0);
  return { month, incomeTotal: sum("income"), expenseTotal: sum("expense"), inMonth };
}

export function computeSummary(state: MockLedger, month: string): MonthlySummary {
  const current = totals(state.entries, month);
  const previous = totals(state.entries, shift(month, -1));
  const byCategory = new Map<string, CategoryAmount>();
  for (const entry of current.inMonth) {
    const item = byCategory.get(entry.categoryId) ?? {
      categoryId: entry.categoryId,
      name: entry.categoryName,
      kind: entry.kind,
      amount: 0,
      ratio: 0,
    };
    item.amount += entry.amount;
    byCategory.set(entry.categoryId, item);
  }
  const kindTotal = { income: current.incomeTotal, expense: current.expenseTotal };
  const [year, number] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const daily: DailyAmount[] = Array.from({ length: days }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const ofDay = current.inMonth.filter((entry) => entry.occurredOn === date);
    const sum = (kind: EntryKind) => ofDay.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.amount, 0);
    return { date, income: sum("income"), expense: sum("expense") };
  });
  const merchants = new Map<string, { merchant: string; amount: number; count: number }>();
  for (const entry of current.inMonth) {
    if (entry.kind !== "expense" || !entry.merchant) continue;
    const item = merchants.get(entry.merchant) ?? { merchant: entry.merchant, amount: 0, count: 0 };
    item.amount += entry.amount;
    item.count += 1;
    merchants.set(entry.merchant, item);
  }
  return {
    month,
    incomeTotal: current.incomeTotal,
    expenseTotal: current.expenseTotal,
    net: current.incomeTotal - current.expenseTotal,
    previous: { month: previous.month, incomeTotal: previous.incomeTotal, expenseTotal: previous.expenseTotal },
    expenseChangeRate: previous.expenseTotal
      ? round2(((current.expenseTotal - previous.expenseTotal) / previous.expenseTotal) * 100)
      : null,
    byCategory: [...byCategory.values()]
      .map((item) => ({ ...item, ratio: round2((item.amount / kindTotal[item.kind]) * 100) }))
      .sort((a, b) => (a.kind === b.kind ? b.amount - a.amount : a.kind === "expense" ? -1 : 1)),
    daily,
    topMerchants: [...merchants.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
  };
}

function toEntry(state: MockLedger, input: EntryInput, id: string, source: Entry["source"] = "manual"): Entry {
  const category = state.categories.find((item) => item.id === input.categoryId);
  sequence += 1;
  const stamp = new Date(Date.UTC(2026, 9, 1, 0, 0, sequence)).toISOString().replace(".000Z", "Z");
  return { ...input, cardName: null, approvalNo: null, isCancellation: false, importBatchId: null, id, categoryName: category?.name ?? "?", source, createdAt: stamp, updatedAt: stamp };
}

function sortEntries(entries: Entry[]) {
  return [...entries].sort((a, b) =>
    a.occurredOn === b.occurredOn ? b.createdAt.localeCompare(a.createdAt) : b.occurredOn.localeCompare(a.occurredOn),
  );
}

/** 가짜 가계부 서버를 띄운다. seed의 category는 카테고리 이름이다. */
export function mockLedger(seed: SeedEntry[] = []): MockLedger {
  const state: MockLedger = { categories: defaultCategories(), entries: [], requests: [], bodies: [] };
  seed.forEach((item, index) => {
    const kind = item.kind ?? "expense";
    const category = state.categories.find((candidate) => candidate.kind === kind && candidate.name === item.category);
    if (!category) throw new Error(`없는 카테고리: ${item.category}`);
    state.entries.push(
      toEntry(
        state,
        {
          kind,
          occurredOn: item.occurredOn,
          amount: item.amount,
          categoryId: category.id,
          merchant: item.merchant ?? null,
          paymentMethod: "card",
          memo: item.memo ?? null,
        },
        `entry-${index + 1}`,
        item.source,
      ),
    );
  });

  function record(request: Request) {
    const url = new URL(request.url);
    state.requests.push(`${request.method} ${url.pathname}${url.search}`);
  }
  async function readBody(request: Request) {
    const body = await request.json();
    state.bodies.push({ method: request.method, path: new URL(request.url).pathname, body });
    return body;
  }

  server.use(
    http.get(apiUrl("/api/ledger/categories"), ({ request }) => {
      record(request);
      return HttpResponse.json({ items: state.categories });
    }),
    http.post(apiUrl("/api/ledger/categories"), async ({ request }) => {
      record(request);
      const body = (await readBody(request)) as { kind: EntryKind; name: string };
      const name = body.name.trim();
      if (state.categories.some((item) => item.kind === body.kind && item.name === name)) {
        return errorResponse(409, "CONFLICT", "이미 있는 카테고리입니다.");
      }
      const category: Category = { id: `cat-new-${state.categories.length}`, kind: body.kind, name, isDefault: false, sortOrder: 0 };
      state.categories.push(category);
      return HttpResponse.json(category, { status: 201 });
    }),
    http.patch(apiUrl("/api/ledger/categories/:id"), async ({ request, params }) => {
      record(request);
      const body = (await readBody(request)) as { name: string };
      const category = state.categories.find((item) => item.id === params.id);
      if (!category) return errorResponse(404, "NOT_FOUND", "카테고리를 찾을 수 없습니다.");
      category.name = body.name.trim();
      state.entries.forEach((entry) => {
        if (entry.categoryId === category.id) entry.categoryName = category.name;
      });
      return HttpResponse.json(category);
    }),
    http.delete(apiUrl("/api/ledger/categories/:id"), ({ request, params }) => {
      record(request);
      const category = state.categories.find((item) => item.id === params.id);
      if (!category) return errorResponse(404, "NOT_FOUND", "카테고리를 찾을 수 없습니다.");
      const fallback = state.categories.find(
        (item) => item.isDefault && item.kind === category.kind && item.name.startsWith("기타"),
      )!;
      state.entries.forEach((entry) => {
        if (entry.categoryId === category.id) Object.assign(entry, { categoryId: fallback.id, categoryName: fallback.name });
      });
      state.categories = state.categories.filter((item) => item.id !== category.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(apiUrl("/api/ledger/entries"), ({ request }) => {
      record(request);
      const url = new URL(request.url);
      const month = url.searchParams.get("month") ?? "";
      const kind = url.searchParams.get("kind");
      const categoryId = url.searchParams.get("categoryId");
      const q = url.searchParams.get("q")?.toLowerCase();
      const page = Number(url.searchParams.get("page") ?? 1);
      const pageSize = Number(url.searchParams.get("pageSize") ?? 20);
      const matched = sortEntries(state.entries).filter(
        (entry) =>
          entry.occurredOn.startsWith(month) &&
          (!kind || entry.kind === kind) &&
          (!categoryId || entry.categoryId === categoryId) &&
          (!q || [entry.merchant, entry.memo].some((text) => text?.toLowerCase().includes(q))),
      );
      return HttpResponse.json({
        items: matched.slice((page - 1) * pageSize, page * pageSize),
        page,
        pageSize,
        total: matched.length,
      });
    }),
    http.post(apiUrl("/api/ledger/entries"), async ({ request }) => {
      record(request);
      const body = (await readBody(request)) as EntryInput;
      const entry = toEntry(state, body, `entry-new-${state.entries.length + 1}`);
      state.entries.push(entry);
      return HttpResponse.json(entry, { status: 201 });
    }),
    http.patch(apiUrl("/api/ledger/entries/:id"), async ({ request, params }) => {
      record(request);
      const body = (await readBody(request)) as Partial<EntryInput>;
      const entry = state.entries.find((item) => item.id === params.id);
      if (!entry) return errorResponse(404, "NOT_FOUND", "내역을 찾을 수 없습니다.");
      Object.assign(entry, body, {
        categoryName: state.categories.find((item) => item.id === (body.categoryId ?? entry.categoryId))?.name,
      });
      return HttpResponse.json(entry);
    }),
    http.delete(apiUrl("/api/ledger/entries/:id"), ({ request, params }) => {
      record(request);
      if (!state.entries.some((item) => item.id === params.id)) return errorResponse(404, "NOT_FOUND", "내역을 찾을 수 없습니다.");
      state.entries = state.entries.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(apiUrl("/api/ledger/summary"), ({ request }) => {
      record(request);
      const month = new URL(request.url).searchParams.get("month") ?? "";
      return HttpResponse.json(computeSummary(state, month));
    }),
    http.get(apiUrl("/api/ledger/trend"), ({ request }) => {
      record(request);
      const months = Number(new URL(request.url).searchParams.get("months") ?? 6);
      const items = Array.from({ length: months }, (_, index) => {
        const { month, incomeTotal, expenseTotal } = totals(state.entries, shift("2026-10", index - months + 1));
        return { month, incomeTotal, expenseTotal };
      });
      return HttpResponse.json({ items });
    }),
  );
  return state;
}

/** 스펙 03 5.3 예시 값: 10월 수입 3,500,000·지출 1,820,000, 9월 지출 2,010,000 → 전월 대비 −9.45% */
export const OCTOBER_SEED: SeedEntry[] = [
  { kind: "income", occurredOn: "2026-10-25", amount: 3_000_000, category: "급여", merchant: "회사" },
  { kind: "income", occurredOn: "2026-10-25", amount: 500_000, category: "상여" },
  { occurredOn: "2026-10-01", amount: 800_000, category: "주거·관리비", merchant: "관리사무소" },
  { occurredOn: "2026-10-02", amount: 100_000, category: "교통", memo: "교통카드 충전" },
  { occurredOn: "2026-10-15", amount: 520_000, category: "식비", merchant: "마트" },
  { occurredOn: "2026-10-15", amount: 400_000, category: "쇼핑", merchant: "쿠팡", source: "import" },
  { occurredOn: "2026-09-30", amount: 2_010_000, category: "식비", merchant: "마트" },
  { kind: "income", occurredOn: "2026-09-25", amount: 3_500_000, category: "급여" },
];
