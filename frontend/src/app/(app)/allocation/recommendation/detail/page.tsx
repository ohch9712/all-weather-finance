import type { Metadata } from "next";
import { RecommendationDetail } from "@/features/allocation/components/RecommendationDetail";

export const metadata: Metadata = { title: "추천 상세 설명" };

export default function AllocationRecommendationDetailPage() {
  return <RecommendationDetail />;
}
