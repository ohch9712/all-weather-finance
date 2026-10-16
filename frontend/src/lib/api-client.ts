import type { ErrorDetail } from "@/types/api";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
export const TIMEOUT_ERROR_MESSAGE = "서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.";
export const UNKNOWN_ERROR_MESSAGE = "잠시 후 다시 시도해 주세요.";

// 응답 헤더가 이 시간 안에 오지 않으면 요청을 끊는다. 백엔드 지연 중에도 화면이 무한 대기하지 않게 한다.
export const REQUEST_TIMEOUT_MS = 10_000;

export type ApiErrorDetail = ErrorDetail;

export class ApiError extends Error {
  constructor(
    public status: number, // 네트워크 실패·타임아웃은 0
    public code: string, // 서버 error.code, "NETWORK_ERROR", "TIMEOUT" 또는 "UNKNOWN_ERROR"
    message: string,
    public details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** 화면에 보여 줄 에러 문구. ApiError가 아니면 일반 문구를 쓴다. */
export function getErrorMessage(error: unknown): string {
  return isApiError(error) && error.message ? error.message : UNKNOWN_ERROR_MESSAGE;
}

// realm마다 DOMException이 달라(브라우저·Node·jsdom) instanceof 대신 이름으로 판별한다.
function isAbortError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function toApiError(status: number, body: unknown): ApiError {
  const error = (body as { error?: unknown } | undefined)?.error as
    | { code?: unknown; message?: unknown; details?: unknown }
    | undefined;
  if (!error || typeof error.code !== "string" || typeof error.message !== "string") {
    return new ApiError(status, "UNKNOWN_ERROR", UNKNOWN_ERROR_MESSAGE);
  }
  const details = Array.isArray(error.details)
    ? error.details.filter(
        (detail): detail is ApiErrorDetail =>
          typeof detail?.field === "string" && typeof detail?.message === "string",
      )
    : [];
  return new ApiError(status, error.code, error.message, details);
}

export type ApiFetchInit = RequestInit & { timeoutMs?: number };

/**
 * 백엔드 API 호출. 화면 컴포넌트는 이 함수를 직접 쓰지 않고 `features/<module>/api.ts`를 거친다.
 * - 쿠키 인증이므로 항상 `credentials: "include"`로 보낸다.
 * - 문자열 본문이면 `Content-Type: application/json`을 붙인다.
 * - 4xx·5xx는 서버 에러 형식(`{ error: { code, message, details } }`)을 `ApiError`로 바꿔 던진다.
 * - 204는 `undefined`를 돌려준다.
 */
export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  if (typeof requestInit.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // 호출자의 signal과 타임아웃을 하나의 signal로 합친다. 호출자 취소는 AbortError 그대로 전달한다.
  const controller = new AbortController();
  const callerSignal = requestInit.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL.replace(/\/+$/, "")}${path}`, {
      ...requestInit,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new ApiError(0, "TIMEOUT", TIMEOUT_ERROR_MESSAGE);
    if (callerSignal?.aborted || isAbortError(error)) throw error;
    throw new ApiError(0, "NETWORK_ERROR", NETWORK_ERROR_MESSAGE);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await readJson(response);
    } catch {
      body = undefined;
    }
    throw toApiError(response.status, body);
  }

  if (response.status === 204) return undefined as T;

  try {
    return (await readJson(response)) as T;
  } catch {
    throw new ApiError(response.status, "UNKNOWN_ERROR", UNKNOWN_ERROR_MESSAGE);
  }
}
