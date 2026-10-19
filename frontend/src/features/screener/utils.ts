import { z } from "zod";
import { FIELD_LABELS, type ScreenFilter, type Condition } from "./types";

const fields = Object.keys(FIELD_LABELS) as [
  keyof typeof FIELD_LABELS,
  ...(keyof typeof FIELD_LABELS)[],
];
const decimal = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine(
    (value) =>
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) &&
      Number.isFinite(Number(value)),
    "숫자를 확인해 주세요.",
  );
const conditionSchema = z
  .object({
    field: z.enum(fields),
    op: z.enum(["gt", "gte", "lt", "lte", "between"]),
    value: decimal,
    valueTo: decimal.nullable().default(null),
  })
  .strict()
  .refine(
    (c) =>
      c.op === "between"
        ? c.valueTo !== null && Number(c.value) <= Number(c.valueTo)
        : c.valueTo === null,
    "범위의 끝값을 확인해 주세요.",
  );
export const filterSchema = z
  .object({
    markets: z
      .array(z.enum(["KOSPI", "KOSDAQ"]))
      .nullable()
      .default(null),
    kinds: z
      .array(z.enum(["stock", "etf"]))
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length)
      .nullable()
      .default(null),
    sectors: z.array(z.string()).nullable().default(null),
    conditions: z.array(conditionSchema).max(10).default([]),
    sort: z
      .object({ field: z.enum(fields), direction: z.enum(["asc", "desc"]) })
      .strict()
      .nullable()
      .default(null),
    limit: z.number().int().min(1).max(100).default(30),
    // 범위 필드가 없는 예전 필터·링크는 전체 종목 검색이다.
    universe: z.enum(["all", "watchlist"]).default("all"),
    watchlistGroup: z.string().trim().min(1).max(20).nullable().default(null),
  })
  .strict()
  .refine((f) => f.universe === "watchlist" || f.watchlistGroup === null, {
    message: "관심종목 범위에서만 그룹을 고를 수 있습니다.",
    path: ["watchlistGroup"],
  });
export const emptyFilter = (): ScreenFilter => filterSchema.parse({});

// Python Decimal의 JSON 문자열 표현을 따른다. 소수 끝의 0도 보존한다.
function decimalText(value: string): string {
  const [mantissa, power = "0"] = value
    .toLowerCase()
    .replace(/^\+/, "")
    .split("e");
  const negative = mantissa.startsWith("-");
  const [whole, fraction = ""] = mantissa.replace(/^-/, "").split(".");
  const digits = (whole + fraction).replace(/^0+/, "") || "0";
  const exponent = Number(power) - fraction.length;
  const adjusted = exponent + digits.length - 1;
  let text: string;
  if (exponent <= 0 && adjusted >= -6) {
    const point = digits.length + exponent;
    text =
      point > 0
        ? digits.slice(0, point) +
          (point < digits.length ? "." + digits.slice(point) : "")
        : "0." + "0".repeat(-point) + digits;
  } else {
    text =
      digits[0] +
      (digits.length > 1 ? "." + digits.slice(1) : "") +
      "E" +
      (adjusted >= 0 ? "+" : "") +
      adjusted;
  }
  return (negative ? "-" : "") + text;
}

function canonicalFilter(filter: ScreenFilter): ScreenFilter {
  const parsed = filterSchema.parse(filter);
  return {
    ...parsed,
    conditions: parsed.conditions.map((c) => ({
      ...c,
      value: decimalText(c.value),
      valueTo: c.valueTo === null ? null : decimalText(c.valueTo),
    })),
  };
}
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(sortedJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(record)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + sortedJson(record[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}
export function encodeFilter(filter: ScreenFilter): string {
  const bytes = new TextEncoder().encode(sortedJson(canonicalFilter(filter)));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export function decodeFilter(encoded: string): ScreenFilter {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 20000)
    throw new Error("검색 링크가 올바르지 않습니다.");
  const bytes = Uint8Array.from(
    atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  return filterSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
}
export function conditionLabel(c: Condition): string {
  return `${FIELD_LABELS[c.field]} ${OP_LABELS_LOCAL[c.op]} ${c.value}${c.op === "between" ? ` ~ ${c.valueTo}` : ""}`;
}
const OP_LABELS_LOCAL = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "범위",
};
