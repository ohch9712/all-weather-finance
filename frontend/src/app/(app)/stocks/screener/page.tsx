import { Suspense } from "react";
import { ScreenerPage } from "@/features/screener/components/ScreenerPage";

export default function Page() {
  return (
    <Suspense fallback={<p>조건검색을 불러오는 중이에요.</p>}>
      <ScreenerPage />
    </Suspense>
  );
}
