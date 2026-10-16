import type { Metadata } from "next";
import { AdminPostEditor } from "@/features/learn/components/admin/AdminPostForm";

export const metadata: Metadata = { title: "학습 게시물 수정" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminPostEditor id={id} />;
}
