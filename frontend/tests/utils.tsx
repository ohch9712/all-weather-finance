import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import * as navigation from "next/navigation";
import type { Mock } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/auth/AuthProvider";
import type { AuthPayload, Profile } from "@/features/auth/types";
import { API_BASE_URL } from "@/lib/api-client";

// ── MSW ──────────────────────────────────────────────────────────────

export function apiUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/+$/, "")}${path}`;
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details: { field: string; message: string }[] = [],
) {
  return HttpResponse.json({ error: { code, message, details } }, { status });
}

export const unauthenticated = () => errorResponse(401, "UNAUTHENTICATED", "로그인이 필요합니다.");

/** 기본 응답: 로그인하지 않은 상태 */
export const defaultHandlers = [http.get(apiUrl("/api/auth/me"), unauthenticated)];

export const server = setupServer(...defaultHandlers);

// ── 테스트 데이터 ─────────────────────────────────────────────────────

export const testProfile: Profile = { birthYear: 1994, nickname: "감자", age: 32, ageBand: "30s" };

export function authPayload(overrides: { user?: Partial<AuthPayload["user"]>; profile?: Partial<Profile> } = {}): AuthPayload {
  return {
    user: {
      id: "0f8c1b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      email: "potato@example.com",
      role: "user",
      createdAt: "2026-10-16T03:21:45Z",
      ...overrides.user,
    },
    profile: { ...testProfile, ...overrides.profile },
  };
}

export const emptyProfile: Partial<Profile> = { birthYear: null, nickname: null, age: null, ageBand: null };

/** `GET /api/auth/me` 응답을 정한다. null이면 401 */
export function mockMe(auth: AuthPayload | null) {
  server.use(http.get(apiUrl("/api/auth/me"), () => (auth ? HttpResponse.json(auth) : unauthenticated())));
}

// ── 라우터 목(tests/setup.ts의 next/navigation 목) ───────────────────────

interface MemoryRouter {
  router: {
    push: Mock<(href: string) => void>;
    replace: Mock<(href: string) => void>;
    back: Mock<() => void>;
    forward: Mock<() => void>;
    refresh: Mock<() => void>;
    prefetch: Mock<() => void>;
  };
  readonly pathname: string;
  readonly search: string;
  reset(href?: string): void;
}

export const memoryRouter = (navigation as unknown as { __memoryRouter: MemoryRouter }).__memoryRouter;

// ── 렌더 도우미 ───────────────────────────────────────────────────────

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

interface ProvidersOptions {
  /** 시작 경로(쿼리 포함). 기본 `/` */
  route?: string;
  /** 로그인 상태. AuthPayload면 로그인, null이면 미로그인. 생략하면 기본 핸들러(401) */
  auth?: AuthPayload | null;
  queryClient?: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  { route = "/", auth, queryClient = createTestQueryClient(), ...options }: ProvidersOptions & Omit<RenderOptions, "wrapper"> = {},
) {
  memoryRouter.reset(route);
  if (auth !== undefined) mockMe(auth);
  const user = userEvent.setup();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  return { ...render(ui, { wrapper: Wrapper, ...options }), user, queryClient, router: memoryRouter.router };
}
