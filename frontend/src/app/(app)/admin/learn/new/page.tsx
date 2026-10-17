import type { Metadata } from "next";
import { AdminPostEditor } from "@/features/learn/components/admin/AdminPostForm";

export const metadata: Metadata = { title: "새 학습 게시물" };

export default function Page() {
  return <AdminPostEditor />;
}
