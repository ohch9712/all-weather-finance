import type { Metadata } from "next";
import { PostDetailPage } from "@/features/learn/components/PostDetailView";

export const metadata: Metadata = { title: "학습 글" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PostDetailPage slug={slug} />;
}
