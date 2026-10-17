import type { Metadata } from "next";
import { AdminPostsPage } from "@/features/learn/components/admin/AdminPostsPage";

export const metadata: Metadata = { title: "학습 콘텐츠 관리" };

export default function Page() {
  return <AdminPostsPage />;
}
