import { ASSET_CLASS_COLOR_VAR, type AssetClass } from "@/lib/domain";

// 차트 색은 globals.css의 CSS 변수에서 온다. SVG 속성에 `var(--...)`를 그대로 넘기므로
// 라이트·다크 전환이 다시 렌더링 없이 반영된다. 값과 검증 결과는 globals.css 주석에 있다.

export function cssVar(name: string): string {
  return `var(${name})`;
}

/** 자산군 색. 예: `assetColor("stock")` → `"var(--asset-stock)"` */
export function assetColor(assetClass: AssetClass): string {
  return cssVar(ASSET_CLASS_COLOR_VAR[assetClass]);
}

/** 자산군이 아닌 계열 색. 고정 순서로 배정하고 돌려 쓰지 않는다. */
export const SERIES_COLOR_VARS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6"] as const;

/** 같은 색을 다시 쓰지 않으므로 7번째 계열부터는 "기타"로 묶는 회색을 준다(계열을 6개 이하로 줄여야 한다). */
export const OVERFLOW_SERIES_COLOR = cssVar("--asset-cash");

export function seriesColor(index: number): string {
  const name = SERIES_COLOR_VARS[index];
  return name ? cssVar(name) : OVERFLOW_SERIES_COLOR;
}

/** 축·격자·표면 같은 차트 바탕색 */
export const CHART_CHROME = {
  surface: cssVar("--card"),
  grid: cssVar("--border"),
  axis: cssVar("--muted-foreground"),
  cursor: cssVar("--muted"),
} as const;

/** 캔버스처럼 `var()`를 못 쓰는 곳에서 현재 테마의 실제 색 값을 읽는다. 서버에서는 빈 문자열이다. */
export function readCssColor(name: string, element?: Element): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(element ?? document.documentElement).getPropertyValue(name).trim();
}
