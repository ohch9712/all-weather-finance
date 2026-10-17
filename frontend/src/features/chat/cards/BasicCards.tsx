import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { KeyValueCard, LinkCard, TableCard } from "../types";
import { CardDetailLink, isInternalHref } from "./CardParts";

// 기본 카드 3종(스펙 09 7절). 값은 서버가 형식화한 문자열을 그대로 보여 준다.

export function KeyValueCardView({ card }: { card: KeyValueCard }) {
  return (
    <Card size="sm" data-card-type="key_value">
      <CardHeader>
        <CardTitle className="text-sm">{card.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {card.items.map((item, index) => (
            <div key={`${item.label}-${index}`} className="contents">
              <dt className="text-muted-foreground break-keep">{item.label}</dt>
              <dd className="min-w-0 text-right font-medium break-words">{item.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export function TableCardView({ card }: { card: TableCard }) {
  return (
    <Card size="sm" data-card-type="table">
      <CardHeader>
        <CardTitle className="text-sm">{card.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* 넓은 표는 카드 안에서만 가로로 스크롤한다(화면 전체는 스크롤하지 않는다). */}
        <div className="max-w-full overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                {card.columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      "px-2 py-1.5 font-medium whitespace-nowrap text-muted-foreground",
                      column.align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.rows.map((row, index) => (
                <tr key={index} className="border-b last:border-0">
                  {card.columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn("px-2 py-1.5", column.align === "right" ? "text-right tabular-nums" : "text-left")}
                    >
                      {row[column.key] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {card.footnote && <p className="text-xs text-muted-foreground break-keep">{card.footnote}</p>}
        {/* 15가 더한 선택 필드 href(앱 내부 경로만) */}
        <CardDetailLink href={card.href} />
      </CardContent>
    </Card>
  );
}

export function LinkCardView({ card }: { card: LinkCard }) {
  if (!isInternalHref(card.href)) return null;
  return (
    <Link
      href={card.href}
      data-card-type="link"
      className="flex items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-foreground/10 transition-colors hover:bg-muted"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium break-keep">{card.title}</span>
        {card.description && (
          <span className="block text-xs text-muted-foreground break-keep">{card.description}</span>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
