"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ApiError, UNKNOWN_ERROR_MESSAGE } from "@/lib/api-client";
import * as authApi from "./api";
import type { AuthPayload, AuthUser, Profile } from "./types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  profile: Profile | null;
  /** 로그인 상태 확인(`GET /api/auth/me`)이 401이 아닌 이유로 실패했을 때의 에러. 백엔드가 꺼져 있으면 NETWORK_ERROR다. */
  error: ApiError | null;
  /** 이 화면에서 로그아웃했다. RequireAuth가 로그인 화면으로 다시 보내지 않게 한다(이동은 logout이 맡는다). */
  signedOut: boolean;
  /** 로그인 상태를 다시 확인한다. 401은 null, 그 밖의 실패는 에러를 던진다. */
  refresh(): Promise<AuthPayload | null>;
  /** 가입·로그인 응답으로 상태를 바로 바꾼다. */
  setAuth(payload: AuthPayload): void;
  /** `POST /api/auth/logout` → 쿼리 캐시 비움 → `/login`. 요청이 실패하면 상태를 그대로 두고 에러를 던진다. */
  logout(): Promise<void>;
}

type AuthState = Pick<AuthContextValue, "status" | "user" | "profile" | "error" | "signedOut">;

const LOADING: AuthState = { status: "loading", user: null, profile: null, error: null, signedOut: false };
const UNAUTHENTICATED: AuthState = { ...LOADING, status: "unauthenticated" };

function authenticated(payload: AuthPayload): AuthState {
  return { status: "authenticated", user: payload.user, profile: payload.profile, error: null, signedOut: false };
}

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, "UNKNOWN_ERROR", UNKNOWN_ERROR_MESSAGE);
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(LOADING);
  // 요청·상태 변경마다 증가한다. 늦게 도착한 이전 `/me` 응답이 새 상태를 덮어쓰지 않게 한다.
  const versionRef = useRef(0);

  const load = useCallback(async (): Promise<AuthPayload | null> => {
    const version = ++versionRef.current;
    try {
      const payload = await authApi.getMe();
      if (version === versionRef.current) setState(payload ? authenticated(payload) : UNAUTHENTICATED);
      return payload;
    } catch (error) {
      if (version === versionRef.current) {
        // 이미 로그인된 화면에서 다시 확인하다 실패하면 화면을 유지한다(일시적인 네트워크 오류로 내보내지 않는다).
        setState((current) =>
          current.status === "authenticated" ? current : { ...UNAUTHENTICATED, error: toApiError(error) },
        );
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    load().catch(() => {
      // 실패는 state.error로 보여 준다.
    });
  }, [load]);

  const refresh = useCallback(() => {
    setState((current) => (current.status === "authenticated" ? current : { ...LOADING }));
    return load();
  }, [load]);

  const setAuth = useCallback((payload: AuthPayload) => {
    versionRef.current += 1;
    setState(authenticated(payload));
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    versionRef.current += 1;
    queryClient.clear();
    setState({ ...UNAUTHENTICATED, signedOut: true });
    router.push("/login");
  }, [queryClient, router]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, refresh, setAuth, logout }),
    [state, refresh, setAuth, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth는 AuthProvider 안에서만 사용할 수 있습니다.");
  return context;
}
