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
