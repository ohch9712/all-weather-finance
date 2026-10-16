import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(srcDir).map((path) => ({
  path: relative(srcDir, path).split(sep).join("/"),
  source: readFileSync(path, "utf8"),
}));

describe("구조 규칙", () => {
  it("fetch는 lib/api-client.ts에서만 직접 호출한다(화면 컴포넌트는 features/*/api.ts를 거친다)", () => {
    const offenders = files
      .filter((file) => file.path !== "lib/api-client.ts")
      .filter((file) => /(^|[^.\w])fetch\s*\(/.test(file.source))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("apiFetch는 lib와 features/*/api.ts에서만 부른다", () => {
    const offenders = files
      .filter((file) => !file.path.startsWith("lib/") && !/^features\/[^/]+\/api\.ts$/.test(file.path))
      .filter((file) => /\bapiFetch\s*[<(]/.test(file.source))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("자산군 색은 hex를 직접 쓰지 않고 --asset-* 토큰을 쓴다(globals.css 제외)", () => {
    const offenders = files
      .filter((file) => file.path.startsWith("components/charts/") || file.path.startsWith("features/"))
      .filter((file) => /#[0-9a-fA-F]{6}\b/.test(file.source))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
