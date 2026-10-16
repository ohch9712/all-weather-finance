import { HttpResponse, delay, http } from "msw";
import { describe, expect, it } from "vitest";
import { getMe, login, logout, signup, updateProfile } from "@/features/auth/api";
import { API_BASE_URL, ApiError, REQUEST_TIMEOUT_MS, apiFetch } from "@/lib/api-client";
import { apiUrl, authPayload, errorResponse, server, unauthenticated } from "../utils";

async function catchError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("에러가 발생해야 합니다.");
}

describe("apiFetch", () => {
  it("API_BASE_URL에 경로를 붙이고 credentials: include로 요청한다", async () => {
    let seen: Request | undefined;
    server.use(
      http.get(apiUrl("/api/health"), ({ request }) => {
        seen = request;
        return HttpResponse.json({ status: "ok" });
      }),
    );
    await expect(apiFetch("/api/health")).resolves.toEqual({ status: "ok" });
    expect(seen?.url).toBe(`${API_BASE_URL}/api/health`);
    expect(seen?.credentials).toBe("include");
  });

  it("문자열 본문이면 Content-Type: application/json을 붙인다", async () => {
    let contentType: string | null = null;
    server.use(
      http.post(apiUrl("/api/echo"), ({ request }) => {
        contentType = request.headers.get("Content-Type");
        return HttpResponse.json({ ok: true });
      }),
    );
    await apiFetch("/api/echo", { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(contentType).toBe("application/json");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "본문 없는 %s에도 Content-Type: application/json을 붙인다(require_json)",
    async (method) => {
      let contentType: string | null = null;
      server.use(
        http.all(apiUrl("/api/things/1"), ({ request }) => {
          contentType = request.headers.get("Content-Type");
          return new HttpResponse(null, { status: 204 });
        }),
      );
      await apiFetch("/api/things/1", { method });
      expect(contentType).toBe("application/json");
    },
  );

  it("GET과 FormData 본문에는 JSON Content-Type을 붙이지 않는다", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(apiUrl("/api/things"), ({ request }) => {
        seen.push(request.headers.get("Content-Type"));
        return HttpResponse.json([]);
      }),
      http.post(apiUrl("/api/imports"), ({ request }) => {
        seen.push(request.headers.get("Content-Type"));
        return HttpResponse.json({ ok: true });
      }),
    );
    const form = new FormData();
    form.append("file", new Blob(["a,b"], { type: "text/csv" }), "card.csv");
    await apiFetch("/api/things");
    await apiFetch("/api/imports", { method: "POST", body: form });
    expect(seen[0]).toBeNull();
    expect(seen[1]).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("204는 undefined를 돌려준다", async () => {
    server.use(http.post(apiUrl("/api/auth/logout"), () => new HttpResponse(null, { status: 204 })));
    await expect(apiFetch("/api/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("에러 응답을 { error: { code, message, details } } 형식에서 ApiError로 바꾼다", async () => {
    server.use(http.post(apiUrl("/api/auth/signup"), () => errorResponse(409, "EMAIL_ALREADY_EXISTS", "이미 가입된 이메일입니다.")));
    const error = await catchError(apiFetch("/api/auth/signup", { method: "POST", body: "{}" }));
    expect(error).toMatchObject({ status: 409, code: "EMAIL_ALREADY_EXISTS", message: "이미 가입된 이메일입니다.", details: [] });
  });

  it("VALIDATION_ERROR의 details 중 형식이 맞는 항목만 담는다", async () => {
    const details = [{ field: "birthYear", message: "출생연도를 확인해 주세요." }];
    server.use(
      http.put(apiUrl("/api/profile"), () =>
        HttpResponse.json(
          { error: { code: "VALIDATION_ERROR", message: "입력값을 확인해 주세요.", details: [...details, { field: 1 }] } },
          { status: 422 },
        ),
      ),
    );
    const error = await catchError(apiFetch("/api/profile", { method: "PUT", body: "{}" }));
    expect(error).toMatchObject({ status: 422, code: "VALIDATION_ERROR", message: "입력값을 확인해 주세요.", details });
  });

  it("에러 본문을 해석할 수 없으면 UNKNOWN_ERROR", async () => {
    server.use(http.get(apiUrl("/api/auth/me"), () => new HttpResponse("Internal Server Error", { status: 500 })));
    const error = await catchError(apiFetch("/api/auth/me"));
    expect(error).toMatchObject({ status: 500, code: "UNKNOWN_ERROR", message: "잠시 후 다시 시도해 주세요." });
  });

  it("연결하지 못하면 NETWORK_ERROR(status 0)", async () => {
    server.use(http.get(apiUrl("/api/auth/me"), () => HttpResponse.error()));
    const error = await catchError(apiFetch("/api/auth/me"));
    expect(error).toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
      message: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    });
  });

  it("기본 타임아웃은 10초다", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it("응답이 타임아웃 안에 오지 않으면 요청을 끊고 TIMEOUT(status 0)", async () => {
    server.use(
      http.get(apiUrl("/api/slow"), async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    const error = await catchError(apiFetch("/api/slow", { timeoutMs: 30 }));
    expect(error).toMatchObject({
      status: 0,
      code: "TIMEOUT",
      message: "서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
    });
  });

  it("호출자가 취소하면 TIMEOUT이 아니라 AbortError를 그대로 던진다", async () => {
    server.use(
      http.get(apiUrl("/api/slow"), async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    const controller = new AbortController();
    const pending = apiFetch("/api/slow", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("features/auth/api", () => {
  it("signup은 이메일 앞뒤 공백만 걷고 passwordConfirm과 함께 보낸다", async () => {
    let body: unknown;
    server.use(
      http.post(apiUrl("/api/auth/signup"), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(authPayload(), { status: 201 });
      }),
    );
    await expect(
      signup({ email: " Potato@Example.com ", password: "gamja1234", passwordConfirm: "gamja1234" }),
    ).resolves.toEqual(authPayload());
    expect(body).toEqual({ email: "Potato@Example.com", password: "gamja1234", passwordConfirm: "gamja1234" });
  });

  it("login은 email·password만 보낸다", async () => {
    let body: unknown;
    server.use(
      http.post(apiUrl("/api/auth/login"), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(authPayload());
      }),
    );
    await login({ email: "potato@example.com", password: "gamja1234" });
    expect(body).toEqual({ email: "potato@example.com", password: "gamja1234" });
  });

  it("logout은 POST /api/auth/logout을 부른다", async () => {
    let called = 0;
    server.use(
      http.post(apiUrl("/api/auth/logout"), () => {
        called += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(logout()).resolves.toBeUndefined();
    expect(called).toBe(1);
  });

  it("getMe는 로그인 상태면 AuthPayload, 401 UNAUTHENTICATED면 null", async () => {
    server.use(http.get(apiUrl("/api/auth/me"), () => HttpResponse.json(authPayload())));
    await expect(getMe()).resolves.toEqual(authPayload());
    server.use(http.get(apiUrl("/api/auth/me"), unauthenticated));
    await expect(getMe()).resolves.toBeNull();
  });

  it("getMe는 그 밖의 에러(NETWORK_ERROR, 5xx)를 던진다", async () => {
    server.use(http.get(apiUrl("/api/auth/me"), () => HttpResponse.error()));
    expect(await catchError(getMe())).toMatchObject({ code: "NETWORK_ERROR" });
    server.use(http.get(apiUrl("/api/auth/me"), () => errorResponse(500, "INTERNAL_ERROR", "서버 오류가 발생했습니다.")));
    expect(await catchError(getMe())).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });

  it("updateProfile은 PUT /api/profile로 birthYear·nickname을 보낸다", async () => {
    let body: unknown;
    server.use(
      http.put(apiUrl("/api/profile"), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ birthYear: 1994, nickname: null, age: 32, ageBand: "30s" });
      }),
    );
    await expect(updateProfile({ birthYear: 1994, nickname: null })).resolves.toMatchObject({ ageBand: "30s" });
    expect(body).toEqual({ birthYear: 1994, nickname: null });
  });
});
