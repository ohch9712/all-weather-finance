import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LinkListCard } from "../types";
import { isInternalHref } from "./CardParts";

// 학습 자료 링크 목록 카드(스펙 15 5절). 앱 내부 경로만 그린다.

export function LinkListCardView({ card }: { card: LinkListCard }) {
  const links = card.links.filter((link) => isInternalHref(link.href));
  if (links.length === 0) return null;
  return (
    <Card size="sm" data-card-type="link_list">
      <CardHeader>
        <CardTitle className="text-sm break-keep">{card.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="flex items-center gap-3 py-2 hover:bg-muted/50">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium break-keep">{link.title}</span>
                  {link.description && (
                    <span className="block text-xs text-muted-foreground break-keep">{link.description}</span>
                  )}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
