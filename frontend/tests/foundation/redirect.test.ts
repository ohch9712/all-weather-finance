import { describe, expect, it } from "vitest";
import { getLoginPath, getSafeRedirectPath } from "@/features/auth/redirect";

const ORIGIN = "http://localhost:3001";

describe("getSafeRedirectPath(같은 사이트 경로만 허용)", () => {
  it.each([
    ["/", "/"],
    ["/ledger", "/ledger"],
    ["/allocation?x=1#a", "/allocation?x=1#a"],
    ["/allocation/survey?onboarding=1", "/allocation/survey?onboarding=1"],
    ["/stocks/005930", "/stocks/005930"],
    ["/learn/./glossary", "/learn/glossary"],
  ])("정상 내부 경로 %s → %s", (next, expected) => {
    expect(getSafeRedirectPath(next, ORIGIN)).toBe(expected);
  });

  it.each([
    // 제어문자: URL 파서가 지우면 //evil 이 되어 외부로 나간다(검증 발견 사항 1)
    ["/\n/evil.example.com"],
    ["/\r/evil.example.com"],
    ["/\t/evil.example.com"],
    ["/\u0000/evil.example.com"],
    ["/\u001f/evil.example.com"],
    ["/\u007f/evil.example.com"],
    ["/ledger\n"],
    // 퍼센트 인코딩된 제어문자·슬래시(한 번 더 인코딩돼 들어온 경우)
    ["/%0A/evil.example.com"],
    ["/%0D/evil.example.com"],
    ["/%09/evil.example.com"],
    ["/%2F/evil.example.com"],
    ["/%5Cevil.example.com"],
    ["/%E0%A4%A"],
    // 다른 origin
    ["//evil.example.com"],
    ["/\\evil.example.com"],
    ["/\\/evil.example.com"],
    ["https://evil.example.com"],
    ["http://localhost:3001/ledger"],
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["evil.example.com"],
    [" /ledger"],
    [""],
  ])("거절 %j → /", (next) => {
    expect(getSafeRedirectPath(next, ORIGIN)).toBe("/");
  });

  // 정규화(점 구간 제거, 백슬래시 → 슬래시) 뒤 //로 시작하게 되는 값(2차 검증 발견 사항)
  it.each([
    ["/.//verify.invalid"],
    ["/a/..//verify.invalid"],
    ["/%2e//verify.invalid"],
    ["/.\\/verify.invalid"],
    ["/%2e%2e//evil.example.com"],
    ["/.\\/evil.example.com"],
    ["/a/../..//evil.example.com"],
    ["/./%2e//evil.example.com"],
    ["/%2F/evil.example.com"],
    ["/%5Cevil.example.com"],
    ["/.%2e//evil.example.com"],
  ])("정규화하면 외부 주소가 되는 %j → /", (next) => {
    expect(getSafeRedirectPath(next, ORIGIN)).toBe("/");
  });

  it("정규화 뒤 같은 사이트 경로로 남는 값은 그 경로로 보낸다", () => {
    expect(getSafeRedirectPath("/a/.\\./\\evil.example.com", ORIGIN)).toBe("/a//evil.example.com");
    expect(new URL("/a//evil.example.com", ORIGIN).origin).toBe(ORIGIN);
  });

  it.each([["/allocation?x=1#a"], ["/learn/per"], ["/stocks/005930"], ["/settings/profile"]])(
    "정상 내부 경로 %s는 그대로 돌려준다",
    (next) => {
      expect(getSafeRedirectPath(next, ORIGIN)).toBe(next);
    },
  );

  it("성질: 점 구간·인코딩·백슬래시 구간을 깊이 1~4로 조합해도 결과는 항상 같은 사이트 경로다", () => {
    const segments = [".", "..", "%2e", "%2E", "%2e%2e", ".%2e", "", "a", "\\", "%5c", "%2f"];
    const combos: string[][] = [[]];
    const inputs: string[] = [];
    for (let depth = 1; depth <= 4; depth += 1) {
      const next: string[][] = [];
      for (const prefix of combos.filter((combo) => combo.length === depth - 1)) {
        for (const segment of segments) next.push([...prefix, segment]);
      }
      combos.push(...next);
      for (const combo of next) {
        const joined = combo.join("/");
        inputs.push(`/${joined}/evil.example/x`, `${joined}/evil.example/x`);
      }
    }
    // 11 + 11² + 11³ + 11⁴ = 16,104개 조합 × (앞에 / 있음·없음) = 32,208개
    expect(inputs).toHaveLength(32_208);

    const failures = inputs.flatMap((input) => {
      const result = getSafeRedirectPath(input, ORIGIN);
      const ok =
        result.startsWith("/") &&
        !result.startsWith("//") &&
        !result.startsWith("/\\") &&
        new URL(result, ORIGIN).origin === ORIGIN &&
        getSafeRedirectPath(result, ORIGIN) === result;
      return ok ? [] : [{ input, result }];
    });
    expect(failures).toEqual([]);
  });

  it("null·undefined는 /", () => {
    expect(getSafeRedirectPath(null, ORIGIN)).toBe("/");
    expect(getSafeRedirectPath(undefined, ORIGIN)).toBe("/");
  });

  it("origin을 넘기지 않으면 현재 사이트(window.location.origin) 기준이다", () => {
    expect(getSafeRedirectPath("/ledger?month=2026-10")).toBe("/ledger?month=2026-10");
    expect(getSafeRedirectPath("/\n/evil.example.com")).toBe("/");
  });
});

describe("getLoginPath", () => {
  it("next를 쿼리 값으로 인코딩하고 /는 그대로 둔다", () => {
    expect(getLoginPath("/ledger")).toBe("/login?next=/ledger");
    expect(getLoginPath("/allocation/survey?onboarding=1")).toBe("/login?next=/allocation/survey%3Fonboarding%3D1");
  });
});
