// `next` 쿼리는 같은 사이트의 상대 경로(`/`로 시작)만 허용한다.
// `//evil.com`, `/\evil.com`처럼 다른 origin으로 해석되는 값은 `/`로 바꾼다.
export function getSafeRedirectPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  return next;
}

export function getLoginPath(next: string): string {
  // 쿼리 값 안의 `/`는 그대로 둬도 안전하므로 `/login?next=/ledger` 형태를 유지한다.
  return `/login?next=${encodeURIComponent(next).replace(/%2F/gi, "/")}`;
}
