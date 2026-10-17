import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// 카드 공통 조각(스펙 15 5절). 값은 서버가 형식화한 문자열을 그대로 보여 준다.

/** 앱 내부 경로만 연다. 외부 주소는 그리지 않는다. */
export function isInternalHref(href: unknown): href is string {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
}

/** 카드 아래의 "자세히 보기" 링크. 내부 경로가 아니면 그리지 않는다. */
export function CardDetailLink({ href, label = "자세히 보기" }: { href: unknown; label?: string }) {
  if (!isInternalHref(href)) return null;
  return (
    <Link
      href={href}
      data-card-link=""
      className="inline-flex items-center gap-0.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {label}
      <ChevronRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

/** `+1.11%`는 상승 색, `-1.11%`는 하락 색 */
export function ChangeRateText({ value, className }: { value: string | null; className?: string }) {
  if (!value) return <span className={cn("text-muted-foreground", className)}>-</span>;
  return (
    <span
      className={cn(
        "tabular-nums",
        value.startsWith("+") && "text-money-up",
        value.startsWith("-") && "text-money-down",
        className,
      )}
    >
      {value}
    </span>
  );
}
