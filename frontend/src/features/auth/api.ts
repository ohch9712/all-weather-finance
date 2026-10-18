import { ApiError, apiFetch } from "@/lib/api-client";
import type { AuthPayload, Credentials, Profile, ProfileUpdateInput, SignupInput } from "./types";

// 이메일 정규화(소문자화)는 백엔드가 한다. 프론트는 앞뒤 공백만 걷어 보낸다.
export function signup(input: SignupInput): Promise<AuthPayload> {
  const body: SignupInput = {
    email: input.email.trim(),
    password: input.password,
    passwordConfirm: input.passwordConfirm,
  };
  return apiFetch<AuthPayload>("/api/auth/signup", { method: "POST", body: JSON.stringify(body) });
}

export function login(credentials: Credentials): Promise<AuthPayload> {
  const body: Credentials = { email: credentials.email.trim(), password: credentials.password };
  return apiFetch<AuthPayload>("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
}

export async function logout(): Promise<void> {
  await apiFetch<void>("/api/auth/logout", { method: "POST" });
}

/** `DELETE /api/auth/me`(스펙 19 4절). 비밀번호를 확인한 뒤 계정과 모든 데이터를 지우고 세션 쿠키를 지운다. */
export async function deleteAccount(password: string): Promise<void> {
  await apiFetch<void>("/api/auth/me", { method: "DELETE", body: JSON.stringify({ password }) });
}

/** 로그인 상태면 AuthPayload, `401 UNAUTHENTICATED`면 null. 그 밖의 에러는 그대로 던진다. */
export async function getMe(): Promise<AuthPayload | null> {
  try {
    return await apiFetch<AuthPayload>("/api/auth/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && error.code === "UNAUTHENTICATED") {
      return null;
    }
    throw error;
  }
}

export function getProfile(): Promise<Profile> {
  return apiFetch<Profile>("/api/profile");
}

export function updateProfile(input: ProfileUpdateInput): Promise<Profile> {
  return apiFetch<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(input) });
}
