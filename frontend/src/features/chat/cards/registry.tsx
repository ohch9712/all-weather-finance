import type { ComponentType } from "react";
import type { Card } from "../types";
import { AllocationCardView, DirectionsCardView } from "./AllocationCards";
import { KeyValueCardView, LinkCardView, TableCardView } from "./BasicCards";
import { ComparisonCardView, GiftTaxCardView } from "./EstateCards";
import { LinkListCardView } from "./LinkListCard";
import { SpendingCardView } from "./SpendingCard";
import { StockCardView, StockListCardView } from "./StockCards";

// 카드 렌더러 레지스트리(스펙 09 7절). type별 컴포넌트를 고르고, 모르는 타입은 무시한다.
// 기본 3종(09)과 15의 전용 카드 8종이다.

type CardComponent = ComponentType<{ card: never }>;

const CARD_RENDERERS: Record<string, CardComponent> = {
  key_value: KeyValueCardView,
  table: TableCardView,
  link: LinkCardView,
  allocation: AllocationCardView,
  spending: SpendingCardView,
  stock: StockCardView,
  stock_list: StockListCardView,
  gift_tax: GiftTaxCardView,
  link_list: LinkListCardView,
  directions: DirectionsCardView,
  comparison: ComparisonCardView,
};

export function hasCardRenderer(type: unknown): boolean {
  return typeof type === "string" && Object.hasOwn(CARD_RENDERERS, type);
}

export function ChatCard({ card }: { card: { type: string } | Card }) {
  if (!hasCardRenderer(card?.type)) return null;
  const Renderer = CARD_RENDERERS[card.type] as ComponentType<{ card: typeof card }>;
  return <Renderer card={card} />;
}
