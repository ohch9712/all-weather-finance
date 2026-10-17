import type { Metadata } from "next";
import { DashboardPage } from "@/features/dashboard/components/DashboardPage";

export const metadata: Metadata = { title: "홈" };

export default function HomePage() {
  return <DashboardPage />;
}
