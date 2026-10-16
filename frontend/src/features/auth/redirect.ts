// 로그인 뒤 이동할 `next` 경로 검사(스펙 01 11.4: 같은 사이트 경로만 허용).

// U+0000~U+001F, U+007F. URL 파서는 LF·CR·탭을 지우므로 `/\n/evil.com`이 `//evil.com`(외부 사이트)이 된다.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

function currentOrigin(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

/** 그대로 또는 한 번 풀었을 때 제어문자나 `//`·`/\`로 시작하는 값(다른 origin으로 해석될 수 있는 값)인지 */
function looksUnsafe(value: string): boolean {
  if (CONTROL_CHARACTERS.test(value)) return true;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return true;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return true; // 잘못된 퍼센트 인코딩
  }
  return CONTROL_CHARACTERS.test(decoded) || decoded.startsWith("//") || decoded.startsWith("/\\");
}

/** `value`를 `origin` 기준 URL로 해석해 같은 origin이면 정규화한 `pathname + search + hash`, 아니면 null */
function toSameOriginPath(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    if (url.origin !== new URL(origin).origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * `next`가 같은 사이트의 경로면 정규화한 `pathname + search + hash`를, 아니면 `/`를 돌려준다.
 * - 들어온 값: 제어문자(LF·CR·탭 포함)가 있거나, `/`로 시작하지 않거나, `//`·`/\`로 시작하면 거절한다(퍼센트 인코딩을 한 번 푼 값도 본다).
 * - URL로 해석한 뒤 origin이 현재 사이트와 다르면 거절한다(`javascript:`, 절대 URL 포함).
 * - 돌려줄 값도 다시 검사한다. 정규화(`.`·`..`·`%2e` 구간 제거, `\` → `/`)로 `/.//evil.com`이 `//evil.com`이 될 수 있어서다.
 *   같은 위험 검사를 통과하고, 다시 해석해도 같은 origin의 같은 값(고정점)일 때만 돌려준다.
 */
export function getSafeRedirectPath(next: string | null | undefined, origin: string = currentOrigin()): string {
  if (!next || looksUnsafe(next)) return "/";
  const result = toSameOriginPath(next, origin);
  if (result === null || looksUnsafe(result)) return "/";
  if (toSameOriginPath(result, origin) !== result) return "/";
  return result;
}

export function getLoginPath(next: string): string {
  // 쿼리 값 안의 `/`는 그대로 둬도 안전하므로 `/login?next=/ledger` 형태를 유지한다.
  return `/login?next=${encodeURIComponent(next).replace(/%2F/gi, "/")}`;
}
