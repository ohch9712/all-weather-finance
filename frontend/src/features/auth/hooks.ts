"use client";

import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { login, signup, updateProfile } from "./api";
import { useAuth } from "./AuthProvider";

/** `PUT /api/profile`. 나이대가 바뀌면 다른 모듈 결과도 달라지므로 성공하면 모든 쿼리를 다시 불러오게 한다. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/** 로그인·가입 화면: 이미 로그인한 사용자는 `/`로 보낸다. 방금 제출해 로그인된 경우(`skip`)는 폼이 직접 이동한다. */
export function useRedirectIfAuthenticated(skip: boolean) {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "authenticated" && !skip) router.replace("/");
  }, [status, skip, router]);
}

export function useLogin() {
  return useMutation({ mutationFn: login });
}

export function useSignup() {
  return useMutation({ mutationFn: signup });
}
