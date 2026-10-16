import type { AgeBand } from "@/lib/domain";

// 인증·프로필 API 타입(스펙 01 7절). 필드 이름은 백엔드 camelCase 그대로다.

export type UserRole = "user" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string; // ISO 8601 UTC
}

/** 네 필드는 항상 있다. 출생연도가 없으면 birthYear·age·ageBand가 null이다. */
export interface Profile {
  birthYear: number | null;
  nickname: string | null;
  age: number | null;
  ageBand: AgeBand | null;
}

export interface AuthPayload {
  user: AuthUser;
  profile: Profile;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface SignupInput extends Credentials {
  passwordConfirm: string;
}

export interface ProfileUpdateInput {
  birthYear: number;
  nickname: string | null;
}
