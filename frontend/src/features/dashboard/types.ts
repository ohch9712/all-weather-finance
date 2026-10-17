// 홈 대시보드 API 타입(스펙 16 3절). 필드 이름은 백엔드 camelCase 그대로다.
import type { AssetClass } from "@/lib/domain";

export type AllocationStatus = "needs_profile" | "needs_assessment" | "needs_holdings" | "ready";
export type AllocationGrade = "S" | "A" | "B" | "C" | "D";

export interface AllocationClassWeight {
  assetClass: AssetClass;
  /** 실제 비중(%) */
  actualWeight: number;
  /** 목표 반영 권장 비중(%) */
  targetWeight: number;
}

export interface TopDirection {
  kind: string;
  title: string;
  body: string;
  href: string;
}

export interface AllocationSection {
  status: AllocationStatus;
  score: number | null;
  grade: AllocationGrade | null;
  scoreDelta: number | null;
  /** `ready`가 아니면 null */
  classes: AllocationClassWeight[] | null;
  /** 관리 방향 첫 항목. 진단 전이면 null */
  topDirection: TopDirection | null;
}

export interface LedgerCategoryAmount {
  name: string;
  amount: number;
  ratio: number;
}

export interface LedgerSection {
  /** `YYYY-MM` */
  month: string;
  incomeTotal: number;
  expenseTotal: number;
  /** 전월 대비 지출 변화율(%). 전월 지출이 0이면 null */
  expenseChangeRate: number | null;
  topCategories: LedgerCategoryAmount[];
}

export type TradeCurrency = "KRW" | "USD";

export interface CurrencyPnl {
  currency: TradeCurrency;
  /** 문자열 decimal */
  realizedPnl: string;
}

export interface JournalSection {
  monthRealizedPnl: CurrencyPnl[];
  winRate: number | null;
  openPositionCount: number;
}

export interface WatchlistEntry {
  code: string;
  name: string;
  /** 문자열 decimal. 시세가 없으면 null */
  price: string | null;
  changeRate: number | null;
}

export interface WatchlistSection {
  items: WatchlistEntry[];
  source: "mock" | "kiwoom" | "toss" | null;
}

export interface EstateMemberDeduction {
  memberId: string;
  displayName: string;
  /** 남은 직계존속 증여재산공제(원) */
  available: number;
  /** `YYYY-MM-DD`. 10년 합산에서 가장 먼저 빠지는 날 */
  nextResetOn: string | null;
}

export interface EstateSection {
  members: EstateMemberDeduction[];
}

/** 07 PostSummary(오늘의 용어) */
export interface TermPost {
  id: string;
  kind: "article" | "video" | "glossary";
  slug: string;
  title: string;
  summary: string;
  term: string | null;
  level: string;
  tags: string[];
  videoId: string | null;
  aiAssisted: boolean;
  publishedAt: string | null;
  bookmarked: boolean;
  read: boolean;
}

export interface LearnSection {
  today: TermPost | null;
  readCount: number;
  publishedCount: number;
}

export interface ChatSection {
  enabled: boolean;
  location: "local" | "cloud" | null;
}

export type ChecklistKey = "risk_assessment" | "situation" | "holdings" | "ledger_entry" | "watchlist";

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  done: boolean;
  href: string;
}

export type DashboardSectionName =
  | "allocation"
  | "ledger"
  | "journal"
  | "watchlist"
  | "estate"
  | "learn"
  | "chat"
  | "checklist";

export interface DashboardSectionError {
  section: DashboardSectionName;
  code: string;
}

export interface DashboardSummary {
  greetingName: string;
  allocation: AllocationSection | null;
  ledger: LedgerSection | null;
  journal: JournalSection | null;
  watchlist: WatchlistSection | null;
  estate: EstateSection | null;
  learn: LearnSection | null;
  chat: ChatSection;
  checklist: ChecklistItem[];
  errors: DashboardSectionError[];
}
